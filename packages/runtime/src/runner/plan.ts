import type { LlmClient } from "@sockt/types";
import type { ExecutionContext, PlanResult, PlanStep } from "../types.ts";

function buildPlanInstruction(maxSteps: number): string {
  return `Based on the task description and context, create a concise step-by-step execution plan.
Respond with a JSON object in this exact format:
{"steps": [{"description": "what to do", "tool": "tool_name_if_needed", "args": {"key": "value"}}]}

Rules:
- Maximum ${maxSteps} steps — stay well within this limit
- Each step must be atomic and achievable in one action
- Prefer fewer, broader steps over many narrow ones
- The "tool" and "args" fields are optional — only include if a specific tool is needed
- For simple text/research tasks, 1-2 steps is usually enough`;
}

export async function planPhase(
  ctx: ExecutionContext,
  llmClient: LlmClient,
  maxSteps: number,
): Promise<PlanResult> {
  // Budget-aware step limit — leave 1 slot free for reflect
  const stepsAllowed = Math.max(1, Math.min(maxSteps, ctx.budgetRemaining - 1));
  // Keep full history for planning if context is small; trim to system prompt if large
  const contextLimit = Number(process.env.PLAN_CONTEXT_MESSAGES ?? 0);
  const planHistory = contextLimit > 0
    ? [ctx.messages[0], ...ctx.messages.slice(-contextLimit)]
    : ctx.messages.slice(0, 1); // system prompt only by default (token-efficient)
  const planMessages = [
    ...planHistory.filter((m): m is NonNullable<typeof m> => m !== undefined),
    { role: "user" as const, content: buildPlanInstruction(stepsAllowed) },
  ];

  const response = await llmClient.chat({
    messages: planMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({ role: "user", content: buildPlanInstruction(stepsAllowed) });
  ctx.messages.push(response.message);

  const contentStr = typeof response.message.content === "string" ? response.message.content : JSON.stringify(response.message.content);
  const plan = parsePlanResponse(contentStr, maxSteps);

  return plan;
}

function parsePlanResponse(content: string, maxSteps: number): PlanResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackPlan(content);
    }

    const parsed = JSON.parse(jsonMatch[0]) as { steps: PlanStep[] };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return fallbackPlan(content);
    }

    return { steps: parsed.steps.slice(0, maxSteps) };
  } catch {
    return fallbackPlan(content);
  }
}

function fallbackPlan(content: string): PlanResult {
  return {
    steps: [{ description: content }],
  };
}
