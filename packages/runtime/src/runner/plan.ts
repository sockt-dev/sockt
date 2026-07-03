import type { LlmClient } from "@sockt/types";
import type { ExecutionContext, PlanResult, PlanStep } from "../types.ts";

const PLAN_INSTRUCTION = `Based on the task description and context, create a step-by-step execution plan.
Respond with a JSON object in this exact format:
{"steps": [{"description": "what to do", "tool": "tool_name_if_needed", "args": {"key": "value"}}]}

Each step should be atomic and achievable. The "tool" and "args" fields are optional - only include them if a tool call is needed.
Keep the plan concise (max 10 steps).`;

export async function planPhase(
  ctx: ExecutionContext,
  llmClient: LlmClient,
  maxSteps: number,
): Promise<PlanResult> {
  const planMessages = [
    ...ctx.messages,
    { role: "user" as const, content: PLAN_INSTRUCTION },
  ];

  const response = await llmClient.chat({
    messages: planMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({ role: "user", content: PLAN_INSTRUCTION });
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
