import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentConfig, LlmConfig, LlmRequest, ModelSelector, ModelSelectionContext, Task } from "@sockt/types";
import { HttpOrchClient } from "../orch-client/client.ts";
import { SkillCompiler } from "../skills/compiler.ts";
import { hasUnbackedCapabilityClaim } from "../skills/hallucination-check.ts";
import { runOutputGate, collectArtifacts } from "../verification/output-gate.ts";
import type { AgentRunnerConfig, ExecutionContext, SkillFile, TaskOutcome } from "../types.ts";
import { buildExecutionContext, injectSkillContext } from "./context.ts";
import { planPhase } from "./plan.ts";
import { actPhase } from "./act.ts";
import type { ActResult } from "./act.ts";
import { observePhase } from "./observe.ts";
import { reflectPhase } from "./reflect.ts";

// Must match packages/orch/src/join/parent-join.ts's constants of the same
// name exactly — runtime has no package dependency on orch (communication
// is HTTP-only, by design), so this contract is duplicated rather than
// imported, the same way HITL decision status strings already cross this
// boundary as plain strings rather than a shared type.
const AWAITING_CHILDREN_PREFIX = "awaiting-children:";
const JOIN_MARKER = "[join] All subtasks finished.";

export class ConfigBasedSelector implements ModelSelector {
  async select(request: LlmRequest, _context: ModelSelectionContext): Promise<LlmConfig> {
    return request.config;
  }
}

export class AgentRunner {
  private readonly orchClient: HttpOrchClient;
  private readonly skillCompiler: SkillCompiler | null;
  private readonly maxPlanSteps: number;
  private readonly reflectionEnabled: boolean;
  private readonly config: AgentRunnerConfig;
  private readonly runningTasks = new Map<string, AbortController>();
  private readonly runningContexts = new Map<string, ExecutionContext>();

  constructor(config: AgentRunnerConfig) {
    this.config = config;
    this.orchClient = new HttpOrchClient({ baseUrl: config.orchBaseUrl, apiToken: config.orchApiToken });
    this.skillCompiler = config.skillsDir ? new SkillCompiler(config.skillsDir) : null;
    this.maxPlanSteps = config.maxPlanSteps ?? 10;
    this.reflectionEnabled = config.reflectionEnabled ?? true;
  }

  async executeTask(agent: AgentConfig, task: Task): Promise<TaskOutcome> {
    const controller = new AbortController();
    this.runningTasks.set(task.id, controller);
    const ctx = buildExecutionContext(agent, task, controller.signal);
    this.runningContexts.set(task.id, ctx);

    try {
      const outcome = await this.runLoop(ctx);
      if (!ctx.trace.getOutcome()) ctx.trace.setOutcome(outcome);
      return outcome;
    } finally {
      this.runningTasks.delete(task.id);
      this.runningContexts.delete(task.id);
      await this.persistTrace(ctx).catch((e) => {
        console.error(`[runtime] failed to persist trace for task=${task.id}:`, e);
      });
    }
  }

  cancel(taskId: string): void {
    const controller = this.runningTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.runningTasks.delete(taskId);
    }
  }

  getState(taskId: string): ExecutionContext | null {
    return this.runningContexts.get(taskId) ?? null;
  }

  /** taskIds returned by every successful create_task call in this trace,
   * in order. Used to decide whether "complete" should actually mean
   * "blocked, waiting on the subtasks I just delegated to" instead. */
  private childTaskIds(ctx: ExecutionContext): string[] {
    return ctx.trace.getSteps()
      .filter((s) => s.phase === "act" && s.toolCall?.name === "create_task")
      .map((s) => (s.output as { taskId?: string } | undefined)?.taskId)
      .filter((id): id is string => typeof id === "string");
  }

  /** If this run delegated via create_task and hasn't already been resumed
   * from a prior join (checked via JOIN_MARKER in the task description —
   * see parent-join.ts), "complete" actually means "wait for the children,
   * then synthesize" — return a blocked outcome instead of completing, so
   * the parent doesn't post a reply while subtasks are still running and
   * nothing ever aggregates their output into one final answer. Returns
   * null when there's nothing to wait on and the caller should complete
   * normally. */
  private maybeBlockOnChildren(ctx: ExecutionContext): TaskOutcome | null {
    if (ctx.task.description.includes(JOIN_MARKER)) return null; // this run IS the resumed join
    const childIds = this.childTaskIds(ctx);
    if (childIds.length === 0) return null;
    return { status: "blocked", dependency: `${AWAITING_CHILDREN_PREFIX}${childIds.join(",")}` };
  }

  /** Picks the skill whose `checks` apply to this task's output, per
   * spec §1.4: an explicit task.targetSkill (set by create_task's `skill`
   * param, see docs/ARCHITECTURE.md) is deterministic and wins; otherwise
   * fall back to the top skill-matcher hit from runLoop's findRelevant call
   * (ctx.matchedSkills). Null when neither is available — the gate still
   * runs its always-on built-ins (capability-claim) in that case. */
  private async resolveGateSkill(ctx: ExecutionContext): Promise<SkillFile | null> {
    if (ctx.task.targetSkill && this.skillCompiler) {
      const skill = await this.skillCompiler.loadByName(ctx.task.targetSkill);
      if (skill) return skill;
    }
    return ctx.matchedSkills[0] ?? null;
  }

  /** Runs the output verification gate over a candidate completion output
   * and decides what actually happens next:
   *  - gate passes -> a "completed" outcome carrying the (possibly
   *    human-review-annotated) output
   *  - gate fails and another attempt is affordable -> pushes retry
   *    feedback onto ctx.gateFeedback (read by planPhase/reflectPhase) and
   *    returns null so the caller `continue`s the attempt loop
   *  - gate fails with no attempts left -> escalates instead of silently
   *    posting output that failed mechanical verification
   * Disabled entirely (returns proposedOutput as-is, always "completed")
   * when this.config.outputGateEnabled === false. */
  private async finalizeCompletion(
    ctx: ExecutionContext,
    proposedOutput: string,
    attemptsRemaining: boolean,
  ): Promise<TaskOutcome | null> {
    if (this.config.outputGateEnabled === false) {
      return { status: "completed", output: proposedOutput };
    }

    const skill = await this.resolveGateSkill(ctx);
    const gate = runOutputGate({
      output: proposedOutput,
      artifacts: collectArtifacts(ctx.trace),
      trace: ctx.trace,
      skill,
      task: ctx.task,
      department: ctx.agent.department ?? "general",
    });

    ctx.trace.addStep({
      phase: "reflect",
      action: "verify_output",
      output: gate,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });

    if (gate.pass) {
      return { status: "completed", output: gate.annotatedOutput };
    }

    if (attemptsRemaining) {
      ctx.gateFeedback.push(gate.feedback);
      return null;
    }

    return {
      status: "escalated",
      reason: `Output failed verification: ${gate.blockers.map((b) => b.criterion).join("; ")}`,
    };
  }

  private async persistTrace(ctx: ExecutionContext): Promise<void> {
    if (!this.config.traceLogPath) return;
    await mkdir(dirname(this.config.traceLogPath), { recursive: true });
    const record = {
      taskId: ctx.task.id,
      tenantId: ctx.task.tenantId,
      agentId: ctx.agent.id,
      department: ctx.agent.department,
      ...ctx.trace.toJSON(),
    };
    await appendFile(this.config.traceLogPath, JSON.stringify(record) + "\n", "utf-8");
  }

  private async runLoop(ctx: ExecutionContext): Promise<TaskOutcome> {
    const { agent, task, signal } = ctx;

    if (this.skillCompiler) {
      const skills = await this.skillCompiler.findRelevant(task.description, 3);
      ctx.matchedSkills = skills;
      injectSkillContext(ctx, skills);
    }

    for (let attempt = 0; attempt < task.maxAttempts; attempt++) {
      if (signal.aborted) {
        return { status: "escalated", reason: "Execution cancelled" };
      }

      // ── PLAN ──
      const plan = await planPhase(ctx, this.config.llmClient, this.maxPlanSteps, this.config.toolRegistry);
      ctx.trace.addStep({
        phase: "plan",
        action: "generate_plan",
        output: plan,
        tokenUsage: plan.tokenUsage,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      // ── Execute each plan step: ACT + OBSERVE ──
      for (const step of plan.steps) {
        if (signal.aborted) {
          return { status: "escalated", reason: "Execution cancelled" };
        }

        // Budget check
        const budget = await this.orchClient.recordLlmCall(task.id);
        if (!budget.allowed) {
          const outcome: TaskOutcome = { status: "escalated", reason: "LLM call budget exceeded" };
          ctx.trace.setOutcome(outcome);
          return outcome;
        }
        ctx.budgetRemaining = budget.remaining;

        // Clarifying question — not a real tool call (see ask_user.ts): the
        // agent can't observe a human's answer within this same run, so this
        // short-circuits the loop instead of going through ACT/OBSERVE.
        if (step.tool === "ask_user") {
          const question = String(step.args?.question ?? step.description);
          const outcome: TaskOutcome = { status: "needs_input", question };
          ctx.trace.setOutcome(outcome);
          return outcome;
        }

        // HITL check
        if (step.tool && this.config.toolRegistry.requiresApproval(step.tool)) {
          const hitlResult = await this.checkHitlApproval(ctx, step.tool, step.description);
          if (hitlResult) return hitlResult;
        }

        // ACT
        const actStart = performance.now();
        const actionResult = await actPhase(ctx, step, this.config.toolRegistry, this.config.llmClient);
        ctx.trace.addStep({
          phase: "act",
          action: step.description,
          toolCall: step.tool ? { id: `call-${Date.now()}`, name: step.tool, arguments: step.args ?? {} } : undefined,
          output: actionResult.toolResult?.output ?? actionResult.llmOutput,
          tokenUsage: actionResult.tokenUsage,
          durationMs: performance.now() - actStart,
          timestamp: new Date().toISOString(),
        });

        // OBSERVE
        const observation = observePhase(ctx, actionResult);
        ctx.trace.addStep({
          phase: "observe",
          action: "observe_result",
          output: observation,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });
      }

      // ── REFLECT ──
      if (!this.reflectionEnabled) {
        const blocked = this.maybeBlockOnChildren(ctx);
        if (blocked) {
          ctx.trace.setOutcome(blocked);
          return blocked;
        }
        // No budget concern once reflection is disabled entirely — no reflect
        // step exists to decide "try again", so a gate failure here escalates
        // rather than looping (spec §1.5: attemptsRemaining = false).
        const outcome = await this.finalizeCompletion(ctx, "Task steps executed", false);
        if (outcome === null) continue; // defensive — finalizeCompletion(..., false) never returns null
        ctx.trace.setOutcome(outcome);
        if (outcome.status === "completed") await this.onComplete(ctx);
        return outcome;
      }

      // If budget nearly exhausted, complete with what we have rather than looping
      if (ctx.budgetRemaining <= 1) {
        const lastObservation = ctx.trace.getSteps()
          .filter(s => s.phase === "observe")
          .map(s => typeof s.output === "string" ? s.output : JSON.stringify(s.output ?? ""))
          .pop() ?? "Task steps executed";
        const blocked = this.maybeBlockOnChildren(ctx);
        if (blocked) {
          ctx.trace.setOutcome(blocked);
          return blocked;
        }
        const outcome = await this.finalizeCompletion(ctx, lastObservation, false);
        if (outcome === null) continue; // defensive — finalizeCompletion(..., false) never returns null
        ctx.trace.setOutcome(outcome);
        if (outcome.status === "completed") await this.onComplete(ctx);
        return outcome;
      }

      const reflection = await reflectPhase(ctx, this.config.llmClient);
      ctx.trace.addStep({
        phase: "reflect",
        action: "reflect",
        output: reflection,
        tokenUsage: reflection.tokenUsage,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      if (reflection.complete) {
        const blocked = this.maybeBlockOnChildren(ctx);
        if (blocked) {
          ctx.trace.setOutcome(blocked);
          return blocked;
        }
        const attemptsRemaining = attempt < task.maxAttempts - 1 && ctx.budgetRemaining > 2;
        const outcome = await this.finalizeCompletion(ctx, reflection.output ?? "", attemptsRemaining);
        if (outcome === null) continue; // gate failed with attempts left — retry with ctx.gateFeedback populated
        ctx.trace.setOutcome(outcome);
        if (outcome.status === "completed") await this.onComplete(ctx);
        return outcome;
      }

      if (reflection.escalate) {
        const outcome: TaskOutcome = { status: "escalated", reason: reflection.reason ?? "Agent decided to escalate" };
        ctx.trace.setOutcome(outcome);
        return outcome;
      }
    }

    const outcome: TaskOutcome = { status: "escalated", reason: "Max attempts reached" };
    ctx.trace.setOutcome(outcome);
    return outcome;
  }

  private async checkHitlApproval(ctx: ExecutionContext, tool: string, description: string): Promise<TaskOutcome | null> {
    if (!this.config.hitlGate) return null;

    const requestId = await this.config.hitlGate.requestApproval({
      tenantId: ctx.task.tenantId,
      agentId: ctx.agent.id,
      taskId: ctx.task.id,
      tier: "confirm",
      action: tool,
      description: description,
    });

    const timeoutMs = Number(process.env.HITL_TIMEOUT_MS ?? 300_000);
    const decision = await this.config.hitlGate.waitForApproval(requestId, timeoutMs);
    // Fail-closed: anything other than an explicit "approved" blocks the tool.
    // Was `=== "denied"` only, which let a "timeout" decision fall through and
    // execute the gated tool anyway — a fail-open approval gate is worse than
    // no gate at all. Found while building out the HITL system (2026-07-12).
    if (decision.status !== "approved") {
      return { status: "blocked", dependency: `HITL ${decision.status}: ${tool}` };
    }

    return null;
  }

  private async onComplete(ctx: ExecutionContext): Promise<void> {
    // Disabled by default: isSuccessful() only checks FSM status === "completed",
    // which has no relationship to whether the task's output was truthful. The
    // 2026-07-11 eval pass found the runner routinely marks fabricated results
    // (e.g. a claimed "email sent" with no send-email tool ever invoked) as
    // completed, so compile-on-success was writing hallucinated traces into the
    // department skill directories as if they were proven execution patterns.
    // Set SKILL_COMPILE_ENABLED=true only once compilation is gated behind a
    // real trust signal — as of Phase 3.1 (2026-07-12), that trust signal is
    // hasUnbackedCapabilityClaim(), the same code-checkable capability-
    // hallucination pattern evals/check.ts runs offline over traces.jsonl.
    // This is NOT the validated LLM judge the eval pass nominated (that still
    // doesn't exist — see the Phase 3 status note in evals/test-plan.md) —
    // it only catches the narrow, regex-detectable half of that finding, not
    // subtler hallucinations a judge would need to catch.
    const skillCompileEnabled = process.env.SKILL_COMPILE_ENABLED === "true";
    if (skillCompileEnabled && this.skillCompiler && ctx.trace.isSuccessful() && !hasUnbackedCapabilityClaim(ctx.trace)) {
      await this.skillCompiler.compile(ctx.trace).catch(() => {});
    }
  }
}
