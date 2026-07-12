import type { LlmClient } from "@sockt/types";
import type { ExecutionContext, ReflectionResult } from "../types.ts";

// Intermediate steps stay capped at 120 chars each (stepSummary below) —
// enough to reflect on progress without ballooning context. The FINAL
// deliverable is different: reflect's "output" field needs to be drawn from
// the real artifact, not a 120-char fragment of it, or the output gate
// (verification/output-gate.ts) ends up verifying a summary instead of the
// thing that would actually get posted.
const REFLECT_OUTPUT_CHARS = Number(process.env.REFLECT_OUTPUT_CHARS ?? 6000);

const REFLECT_INSTRUCTION = `Reflect on the actions taken and their results.
Determine if the task is complete, needs more work, or should be escalated.

Respond with a JSON object in this exact format:
{"complete": true/false, "output": "final result if complete", "escalate": true/false, "reason": "reason if escalating"}

- Set "complete": true if the task has been successfully accomplished. Include the final output.
- Set "escalate": true if the task cannot be completed (too complex, needs human help, or impossible).
- Set both to false if more attempts are needed.
- A tool call that failed because of a fixable argument problem (e.g. "requires a non-empty description") is NOT a reason to escalate — set both false and retry with corrected arguments on the next attempt. Only escalate for failures that retrying with different arguments can't fix.`;

export async function reflectPhase(
  ctx: ExecutionContext,
  llmClient: LlmClient,
): Promise<ReflectionResult> {
  // Build a compact summary from trace steps instead of full message history.
  // This keeps reflect context tiny (< 400 tokens) regardless of steps taken.
  const steps = ctx.trace.getSteps?.() ?? [];
  const stepSummary = steps
    .filter(s => s.phase === "act" || s.phase === "observe")
    .map((s, i) => {
      const out = typeof s.output === "string"
        ? s.output.slice(0, 120)
        : JSON.stringify(s.output ?? "").slice(0, 120);
      return `${i + 1}. [${s.phase}] ${s.action}: ${out}`;
    })
    .join("\n");

  let summaryMessage = stepSummary
    ? `Steps completed:\n${stepSummary}`
    : "No steps recorded.";

  // Prefer the last write_file's full content (the actual deliverable);
  // fall back to the last act step's untruncated output otherwise.
  const lastWriteFile = [...steps].reverse().find((s) => s.phase === "act" && s.toolCall?.name === "write_file");
  const lastAct = [...steps].reverse().find((s) => s.phase === "act");
  const finalArtifact = lastWriteFile
    ? String((lastWriteFile.toolCall!.arguments as Record<string, unknown> | undefined)?.content ?? "")
    : lastAct
      ? (typeof lastAct.output === "string" ? lastAct.output : JSON.stringify(lastAct.output ?? ""))
      : "";
  if (finalArtifact) {
    summaryMessage += `\n\nFull content of the final deliverable:\n${finalArtifact.slice(0, REFLECT_OUTPUT_CHARS)}`;
  }

  // A prior attempt failed the output verification gate — see plan.ts's
  // matching injection and verification/output-gate.ts. Without this,
  // reflect would immediately re-declare the same (already-failed) output
  // complete, since its only view of "what happened" is the step summary.
  const gateFeedback = ctx.gateFeedback.length
    ? [{ role: "user" as const, content: ctx.gateFeedback.at(-1)! }]
    : [];

  const reflectMessages = [
    ctx.messages[0], // system prompt only
    { role: "user" as const, content: summaryMessage },
    ...gateFeedback,
    { role: "user" as const, content: REFLECT_INSTRUCTION },
  ].filter((m): m is NonNullable<typeof m> => m !== undefined);

  const response = await llmClient.chat({
    messages: reflectMessages,
    config: ctx.agent.llmConfig,
  });

  ctx.messages.push({ role: "user", content: REFLECT_INSTRUCTION });
  ctx.messages.push(response.message);

  const contentStr = typeof response.message.content === "string" ? response.message.content : JSON.stringify(response.message.content);
  return { ...parseReflectionResponse(contentStr), tokenUsage: response.usage };
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
