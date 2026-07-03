import type { LlmClient } from "@sockt/types";
import type { ExecutionContext, ReflectionResult } from "../types.ts";

const REFLECT_INSTRUCTION = `Reflect on the actions taken and their results.
Determine if the task is complete, needs more work, or should be escalated.

Respond with a JSON object in this exact format:
{"complete": true/false, "output": "final result if complete", "escalate": true/false, "reason": "reason if escalating"}

- Set "complete": true if the task has been successfully accomplished. Include the final output.
- Set "escalate": true if the task cannot be completed (too complex, needs human help, or impossible).
- Set both to false if more attempts are needed.`;

export async function reflectPhase(
  ctx: ExecutionContext,
  llmClient: LlmClient,
): Promise<ReflectionResult> {
  const reflectMessages = [
    ...ctx.messages,
    { role: "user" as const, content: REFLECT_INSTRUCTION },
  ];

  const response = await llmClient.chat({
    messages: reflectMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({ role: "user", content: REFLECT_INSTRUCTION });
  ctx.messages.push(response.message);

  const contentStr = typeof response.message.content === "string" ? response.message.content : JSON.stringify(response.message.content);
  return parseReflectionResponse(contentStr);
}

function parseReflectionResponse(content: string): ReflectionResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*"complete"[\s\S]*\}/);
    if (!jsonMatch) {
      return { complete: false };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ReflectionResult;
    return {
      complete: Boolean(parsed.complete),
      output: parsed.output,
      escalate: Boolean(parsed.escalate),
      reason: parsed.reason,
    };
  } catch {
    return { complete: false };
  }
}
