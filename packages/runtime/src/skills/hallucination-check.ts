import type { ExecutionTrace } from "../trace/execution-trace.ts";

// Kept in sync manually with evals/check.ts's CAPABILITY_CLAIM_PATTERN —
// that script runs the same check offline over traces.jsonl for reporting;
// this one runs inline so SkillCompiler never compiles a trace this obvious
// a check would flag. Neither is an LLM judge (see the Phase 3 status note
// in evals/test-plan.md) — this only catches the code-checkable half of
// capability hallucination.
const CAPABILITY_CLAIM_PATTERN = /\b(email (was |has been )?(sent|delivered)|successfully sent|authentication succeeded|authenticated (as|via)|connection established|tested successfully|restarted (the |)(service|server|postgres|database)|ssh(ed)? (into|to)|logged? in (as|to))\b/i;

/**
 * True if `output` claims a capability-requiring action (sent an email,
 * SSH'd in, restarted a service, ...) with zero tool calls anywhere in
 * `trace` to back it up — the flagship finding from the 2026-07-11 eval
 * pass (G5, E6). Takes an explicit candidate output rather than reading
 * `trace.getOutcome()` so the output gate (verification/output-gate.ts) can
 * test a candidate completion *before* it becomes the trace's outcome —
 * `hasUnbackedCapabilityClaim` runs after the outcome is already set (used
 * to gate SkillCompiler.compile()), `capabilityClaimWithoutTool` runs before.
 */
export function capabilityClaimWithoutTool(output: string, trace: ExecutionTrace): boolean {
  if (!output || !CAPABILITY_CLAIM_PATTERN.test(output)) return false;
  const hasAnyToolCall = trace.getSteps().some((s) => s.phase === "act" && s.toolCall);
  return !hasAnyToolCall;
}

/**
 * True if the trace's completed output claims a capability-requiring action
 * with zero backing tool calls. Used to gate SkillCompiler.compile() so a
 * hallucinated "success" doesn't get written into a department's skill
 * directory as a proven execution pattern. Thin wrapper around
 * capabilityClaimWithoutTool — see its doc for why the two exist separately.
 */
export function hasUnbackedCapabilityClaim(trace: ExecutionTrace): boolean {
  const outcome = trace.getOutcome();
  if (outcome?.status !== "completed" || !outcome.output) return false;
  return capabilityClaimWithoutTool(outcome.output, trace);
}
