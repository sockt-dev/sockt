import type { AgentConfig, LlmConfig, LlmRequest, ModelSelector, ModelSelectionContext, Task } from "@sockt/types";
import { HttpOrchClient } from "../orch-client/client.ts";
import { SkillCompiler } from "../skills/compiler.ts";
import type { AgentRunnerConfig, ExecutionContext, TaskOutcome } from "../types.ts";
import { buildExecutionContext, injectSkillContext } from "./context.ts";
import { planPhase } from "./plan.ts";
import { actPhase } from "./act.ts";
import type { ActResult } from "./act.ts";
import { observePhase } from "./observe.ts";
import { reflectPhase } from "./reflect.ts";

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

  constructor(config: AgentRunnerConfig) {
    this.config = config;
    this.orchClient = new HttpOrchClient({ baseUrl: config.orchBaseUrl });
    this.skillCompiler = config.skillsDir ? new SkillCompiler(config.skillsDir) : null;
    this.maxPlanSteps = config.maxPlanSteps ?? 10;
    this.reflectionEnabled = config.reflectionEnabled ?? true;
  }

  async executeTask(agent: AgentConfig, task: Task): Promise<TaskOutcome> {
    const controller = new AbortController();
    this.runningTasks.set(task.id, controller);

    try {
      return await this.runLoop(agent, task, controller.signal);
    } finally {
      this.runningTasks.delete(task.id);
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
    return null;
  }

  private async runLoop(agent: AgentConfig, task: Task, signal: AbortSignal): Promise<TaskOutcome> {
    const ctx = buildExecutionContext(agent, task, signal);

    if (this.skillCompiler) {
      const skills = await this.skillCompiler.findRelevant(task.description, 3);
      injectSkillContext(ctx, skills);
    }

    for (let attempt = 0; attempt < task.maxAttempts; attempt++) {
      if (signal.aborted) {
        return { status: "escalated", reason: "Execution cancelled" };
      }

      // ── PLAN ──
      const plan = await planPhase(ctx, this.config.llmClient, this.maxPlanSteps);
      ctx.trace.addStep({
        phase: "plan",
        action: "generate_plan",
        output: plan,
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
        const outcome: TaskOutcome = { status: "completed", output: "Task steps executed" };
        ctx.trace.setOutcome(outcome);
        await this.onComplete(ctx);
        return outcome;
      }

      const reflection = await reflectPhase(ctx, this.config.llmClient);
      ctx.trace.addStep({
        phase: "reflect",
        action: "reflect",
        output: reflection,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      if (reflection.complete) {
        const outcome: TaskOutcome = { status: "completed", output: reflection.output ?? "" };
        ctx.trace.setOutcome(outcome);
        await this.onComplete(ctx);
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

    const decision = await this.config.hitlGate.waitForApproval(requestId, 300_000);
    if (decision.status === "denied") {
      return { status: "blocked", dependency: `HITL denied: ${tool}` };
    }

    return null;
  }

  private async onComplete(ctx: ExecutionContext): Promise<void> {
    if (this.skillCompiler && ctx.trace.isSuccessful()) {
      await this.skillCompiler.compile(ctx.trace).catch(() => {});
    }
  }
}
