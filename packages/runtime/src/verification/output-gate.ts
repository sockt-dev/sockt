import type { Task } from "@sockt/types";
import type { ExecutionTrace } from "../trace/execution-trace.ts";
import type { SkillFile } from "../types.ts";
import { capabilityClaimWithoutTool } from "../skills/hallucination-check.ts";
import { isImplementedCheckType, runCheck } from "./checks.ts";

export interface GateFailure {
  /** SkillCheck["type"], or "capability_claim" for the always-on built-in. */
  checkType: string;
  /** The successCriteria text this check enforces. */
  criterion: string;
  /** Concrete and actionable: what was found vs. what's required. */
  detail: string;
}

export interface GateResult {
  pass: boolean;
  blockers: GateFailure[];
  warnings: GateFailure[];
  /** Criteria with no mechanical check — either explicitly `human_review`,
   * a check type not yet implemented (see checks.ts), or a successCriteria
   * entry with no matching `checks` entry at all. Never blocks completion. */
  humanReview: string[];
  annotatedOutput: string;
  /** Pre-formatted retry instruction listing every blocker; "" when pass. */
  feedback: string;
}

export interface OutputGateInput {
  output: string;
  artifacts: string[];
  trace: ExecutionTrace;
  skill: SkillFile | null;
  task: Task;
  department: string;
}

/** Every write_file act step's arguments.content (string-coerced), in
 * order — the deliverable(s) actually produced this run, as opposed to
 * `output` (the reflection summary that would get posted to Slack). */
export function collectArtifacts(trace: ExecutionTrace): string[] {
  return trace
    .getSteps()
    .filter((s) => s.phase === "act" && s.toolCall?.name === "write_file")
    .map((s) => String((s.toolCall!.arguments as Record<string, unknown> | undefined)?.content ?? ""));
}

const REVIEW_FOOTER_ENABLED = process.env.OUTPUT_GATE_REVIEW_FOOTER !== "false";

export function runOutputGate(input: OutputGateInput): GateResult {
  const blockers: GateFailure[] = [];
  const warnings: GateFailure[] = [];
  const humanReview: string[] = [];

  // Always-on built-in, independent of skill: a fabricated "email sent" /
  // "restarted the service" / etc. with no backing tool call fails the gate
  // regardless of which department or skill is involved. See
  // skills/hallucination-check.ts and spec §3.1.
  if (capabilityClaimWithoutTool(input.output, input.trace)) {
    blockers.push({
      checkType: "capability_claim",
      criterion: "No claimed external action without a backing tool call",
      detail:
        "Output claims an action (sent/restarted/connected/authenticated) but no tool call in this run performed it. " +
        "You have no tool that does this — rewrite as a draft/plan and say plainly the action was NOT performed.",
    });
  }

  // Department-specific built-ins beyond the capability-claim check (e.g.
  // product's metric-sourcing check, spec §3.2) land in Phase 3 — see
  // docs/ARCHITECTURE.md's output gate section for the rollout mapping.

  const fullText = [input.output, ...input.artifacts].join("\n\n");
  const checkCtx = { fullText, output: input.output };
  const coveredCriteria = new Set<string>();

  for (const check of input.skill?.checks ?? []) {
    coveredCriteria.add(check.criterion);

    if (check.type === "human_review") {
      humanReview.push(check.criterion);
      continue;
    }

    if (!isImplementedCheckType(check.type)) {
      // Declared ahead of its evaluator (e.g. lead_provenance, evidence_citation
      // — Phase 3). Degrade to human review rather than block or crash.
      humanReview.push(check.criterion);
      continue;
    }

    const failure = runCheck(check, checkCtx);
    if (!failure) continue;
    if (check.severity === "warn") {
      warnings.push(failure);
    } else {
      blockers.push(failure);
    }
  }

  for (const criterion of input.skill?.successCriteria ?? []) {
    if (!coveredCriteria.has(criterion)) humanReview.push(criterion);
  }

  const pass = blockers.length === 0;

  let annotatedOutput = input.output;
  if (REVIEW_FOOTER_ENABLED && (warnings.length > 0 || humanReview.length > 0)) {
    const items = [...warnings.map((w) => w.criterion), ...humanReview];
    annotatedOutput = `${input.output}\n\n_Unverified (needs human review): ${items.join("; ")}_`;
  }

  const feedback = pass
    ? ""
    : `Your previous attempt produced output that FAILED mechanical verification. Fix ALL of these before finishing:\n` +
      blockers.map((b) => `- ${b.criterion}: ${b.detail}`).join("\n");

  return { pass, blockers, warnings, humanReview, annotatedOutput, feedback };
}
