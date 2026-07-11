import type { LlmClient } from "@sockt/types";
import type { ExecutionContext, PlanResult, PlanStep } from "../types.ts";
import type { ToolRegistry } from "../tools/registry.ts";

// Without this, the model has no idea what tools actually exist and invents
// plausible-sounding names ("Python", "SSH client", "GitHub Issues", ...) that
// never match the registry — act.ts falls back to narrating a fictional result
// instead of erroring, so the whole Plan/Act/Observe/Reflect loop silently
// grades its own fiction. Found in the 2026-07-11 eval pass (see evals/test-plan.md).
function buildToolListing(toolRegistry: ToolRegistry): string {
  const defs = toolRegistry.getDefinitions();
  if (defs.length === 0) return "No tools are available — do not set a \"tool\" field on any step.";
  const lines = defs.map((d) => `- "${d.name}": ${d.description}`);
  return `Available tools (use the "tool" field ONLY with one of these EXACT names — do not invent a tool name):\n${lines.join("\n")}`;
}

function buildPlanInstruction(maxSteps: number, toolRegistry: ToolRegistry): string {
  return `Based on the task description and context, create a concise step-by-step execution plan.
Respond with a JSON object in this exact format:
{"steps": [{"description": "what to do", "tool": "tool_name_if_needed", "args": {"key": "value"}}]}

${buildToolListing(toolRegistry)}

Rules:
- Maximum ${maxSteps} steps — stay well within this limit
- Each step must be atomic and achievable in one action
- Prefer fewer, broader steps over many narrow ones
- The "tool" field is optional — omit it entirely for steps that are pure reasoning/writing with no tool call. If you DO set it, it MUST be one of the exact tool names listed above, verbatim — never a made-up or paraphrased name.
- For simple text/research tasks, 1-2 steps is usually enough`;
}

export async function planPhase(
  ctx: ExecutionContext,
  llmClient: LlmClient,
  maxSteps: number,
  toolRegistry: ToolRegistry,
): Promise<PlanResult> {
  // Budget-aware step limit — leave 1 slot free for reflect
  const stepsAllowed = Math.max(1, Math.min(maxSteps, ctx.budgetRemaining - 1));
  // Keep full history for planning if context is small; trim to system prompt if large
  const contextLimit = Number(process.env.PLAN_CONTEXT_MESSAGES ?? 0);
  const planHistory = contextLimit > 0
    ? [ctx.messages[0], ...ctx.messages.slice(-contextLimit)]
    : ctx.messages.slice(0, 1); // system prompt only by default (token-efficient)
  const instruction = buildPlanInstruction(stepsAllowed, toolRegistry);
  const planMessages = [
    ...planHistory.filter((m): m is NonNullable<typeof m> => m !== undefined),
    { role: "user" as const, content: instruction },
  ];

  const response = await llmClient.chat({
    messages: planMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({ role: "user", content: instruction });
  ctx.messages.push(response.message);

  const contentStr = typeof response.message.content === "string" ? response.message.content : JSON.stringify(response.message.content);
  const plan = parsePlanResponse(contentStr, maxSteps, toolRegistry);

  return { ...plan, tokenUsage: response.usage };
}

function parsePlanResponse(content: string, maxSteps: number, toolRegistry: ToolRegistry): PlanResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackPlan(content);
    }

    const parsed = JSON.parse(jsonMatch[0]) as { steps: PlanStep[] };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return fallbackPlan(content);
    }

    // A step naming a tool that doesn't exist in the registry is exactly the
    // failure mode this file exists to prevent — drop the invalid name rather
    // than let act.ts silently fall back to narrating a fictional result under
    // a plausible-looking tool label.
    const steps = parsed.steps.slice(0, maxSteps).map((step) => {
      if (step.tool && !toolRegistry.has(step.tool)) {
        const { tool: _dropped, ...rest } = step;
        return { ...rest, description: `${step.description} [dropped invalid tool name "${step.tool}"]` };
      }
      return step;
    });

    return { steps };
  } catch {
    return fallbackPlan(content);
  }
}

function fallbackPlan(content: string): PlanResult {
  return {
    steps: [{ description: content }],
  };
}
