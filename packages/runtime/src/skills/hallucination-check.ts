import type { ExecutionTrace } from "../trace/execution-trace.ts";

// Kept in sync manually with evals/check.ts's CAPABILITY_CLAIM_PATTERN —
// that script runs the same check offline over traces.jsonl for reporting;
// this one runs inline so SkillCompiler never compiles a trace this obvious
// a check would flag. Neither is an LLM judge (see the Phase 3 status note
// in evals/test-plan.md) — this only catches the code-checkable half of
// capability hallucination.
const CAPABILITY_CLAIM_PATTERN = /\b(email (was |has been )?(sent|delivered)|successfully sent|authentication succeeded|authenticated (as|via)|connection established|tested successfully|restarted (the |)(service|server|postgres|database)|ssh(ed)? (into|to)|logged? in (as|to))\b/i;

/**
 * True if the trace's completed output claims a capability-requiring action
 * (sent an email, SSH'd in, restarted a service, ...) with zero tool calls
 * anywhere in the trace to back it up — the flagship finding from the
 * 2026-07-11 eval pass (G5, E6). Used to gate SkillCompiler.compile() so a
 * hallucinated "success" doesn't get written into a department's skill
 * directory as a proven execution pattern.
 */
export function hasUnbackedCapabilityClaim(trace: ExecutionTrace): boolean {
  const outcome = trace.getOutcome();
  if (outcome?.status !== "completed" || !outcome.output) return false;

  if (!CAPABILITY_CLAIM_PATTERN.test(outcome.output)) return false;

  const hasAnyToolCall = trace.getSteps().some((s) => s.phase === "act" && s.toolCall);
  return !hasAnyToolCall;
}
