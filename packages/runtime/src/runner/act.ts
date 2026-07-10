import type { LlmClient, TokenUsage } from "@sockt/types";
import type { ToolRegistry } from "../tools/registry.ts";
import type { ExecutionContext, PlanStep, ToolExecutionResult } from "../types.ts";

export interface ActResult {
  toolResult?: ToolExecutionResult;
  llmOutput?: string;
  tokenUsage?: TokenUsage;
}

export async function actPhase(
  ctx: ExecutionContext,
  step: PlanStep,
  toolRegistry: ToolRegistry,
  llmClient: LlmClient,
): Promise<ActResult> {
  if (step.tool && toolRegistry.has(step.tool)) {
    const toolResult = await toolRegistry.execute({
      id: `call-${Date.now()}`,
      name: step.tool,
      arguments: step.args ?? {},
    });
    return { toolResult };
  }

  const actMessages = [
    ...ctx.messages,
    {
      role: "user" as const,
      content: `Execute the following step: ${step.description}\n\nProvide the result of this action.`,
    },
  ];

  const response = await llmClient.chat({
    messages: actMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({
    role: "user",
    content: `Execute the following step: ${step.description}`,
  });
  ctx.messages.push(response.message);

  const contentStr = typeof response.message.content === "string" ? response.message.content : JSON.stringify(response.message.content);
  return { llmOutput: contentStr, tokenUsage: response.usage };
}
