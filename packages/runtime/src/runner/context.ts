import type { AgentConfig, Task } from "@sockt/types";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { ExecutionContext, SkillFile } from "../types.ts";

export function buildExecutionContext(
  agent: AgentConfig,
  task: Task,
  signal: AbortSignal,
): ExecutionContext {
  const trace = new ExecutionTrace(task.id, agent.id);

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(agent, task),
    },
  ];

  return {
    agent,
    task,
    messages,
    trace,
    budgetRemaining: task.llmCallsBudget - task.llmCallsUsed,
    signal,
  };
}

export function injectSkillContext(ctx: ExecutionContext, skills: SkillFile[]): void {
  if (skills.length === 0) return;

  const skillsText = skills
    .map((s) => {
      const stepsText = s.steps.map((step, i) => `  ${i + 1}. ${step.action}${step.tool ? ` [tool: ${step.tool}]` : ""}`).join("\n");
      return `### ${s.name}\n${s.description}\nSteps:\n${stepsText}`;
    })
    .join("\n\n");

  ctx.messages.push({
    role: "system",
    content: `You have access to the following previously successful execution patterns:\n\n${skillsText}\n\nUse these as guidance when applicable.`,
  });
}

function buildSystemPrompt(agent: AgentConfig, task: Task): string {
  // Set by an architect's create_task "skill" param — a deterministic
  // directive, not a hint, so the worker doesn't have to guess which skill
  // applies from the description alone (see docs/ARCHITECTURE.md's
  // create_task targeting section).
  const skillDirective = task.targetSkill
    ? `\n- Required skill: ${task.targetSkill} — follow that skill's workflow exactly.`
    : "";

  return `${agent.systemPrompt}

You are working on the following task:
- Task ID: ${task.id}
- Description: ${task.description}
- Attempt: ${task.attemptCount + 1}/${task.maxAttempts}
- Budget remaining: ${task.llmCallsBudget - task.llmCallsUsed} LLM calls${skillDirective}

You will operate in a Plan-Act-Observe-Reflect cycle. Follow instructions carefully.`;
}
