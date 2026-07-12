import type { SkillCheck } from "../types.ts";
import type { GateFailure } from "./output-gate.ts";

/** Types with a real evaluator below. The rest of the SkillCheck union
 * (lead_provenance, computed_number, metric_sourcing, grounded_quotes,
 * evidence_citation) is declared in types.ts because Phase 2's authored
 * checks (§1.7 of the spec) reference them ahead of time, but their
 * evaluators land in Phase 3 — output-gate.ts routes any check whose type
 * isn't in this dispatch table to GateResult.humanReview rather than
 * blocking or crashing, so a Phase-2-authored skill referencing a
 * not-yet-built check type degrades gracefully instead of erroring. */
export type ImplementedCheckType = "section_present" | "regex_present" | "regex_absent" | "max_words" | "count_range";

type CheckOfType<T extends SkillCheck["type"]> = Extract<SkillCheck, { type: T }>;

export interface CheckEvalContext {
  /** output + artifacts, joined with a blank line — what structural checks
   * (sections, presence/absence patterns, counts) run against. */
  fullText: string;
  /** reflection output alone — what message-shaped checks (word limits on
   * the actual reply) run against. */
  output: string;
}

type CheckEvaluator<T extends SkillCheck["type"]> = (check: CheckOfType<T>, ctx: CheckEvalContext) => GateFailure | null;

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

// Splits on markdown horizontal rules or headings — used by max_words'
// "per_section" scope for outreach-copy-style multi-variant output.
function splitSections(text: string): string[] {
  return text
    .split(/\n\s*(?:-{3,}|={3,})\s*\n|\n#{1,6}\s+.*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Matches a heading line in one of three forms: "## Heading", "**Heading**",
// or "Heading:" — case-insensitive, optionally followed by inline content on
// the same line (captured as the body's first line).
function findSectionBody(text: string, heading: string): string | null {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingLineRe = new RegExp(`^(?:#{1,6}\\s*${esc}\\s*:?|\\*\\*${esc}\\*\\*\\s*:?|${esc}\\s*:)\\s*(.*)$`, "i");
  const nextHeadingRe = /^\s*(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*:?\s*$)/;

  const lines = text.split(/\r?\n/);
  let startIdx = -1;
  let inline = "";
  for (let i = 0; i < lines.length; i++) {
    const m = headingLineRe.exec(lines[i]!);
    if (m) {
      startIdx = i;
      inline = (m[1] ?? "").trim();
      break;
    }
  }
  if (startIdx === -1) return null;

  const body: string[] = inline ? [inline] : [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (nextHeadingRe.test(lines[i]!)) break;
    body.push(lines[i]!);
  }
  return body.join("\n").trim();
}

const checkSectionPresent: CheckEvaluator<"section_present"> = (check, ctx) => {
  const minChars = check.minChars ?? 20;
  const body = findSectionBody(ctx.fullText, check.heading);
  const nonWhitespaceLen = body ? body.replace(/\s/g, "").length : 0;
  if (body === null) {
    return { checkType: "section_present", criterion: check.criterion, detail: `No "${check.heading}" section found in the output.` };
  }
  if (nonWhitespaceLen < minChars) {
    return {
      checkType: "section_present",
      criterion: check.criterion,
      detail: `"${check.heading}" section found but has only ${nonWhitespaceLen} non-whitespace characters (need at least ${minChars}).`,
    };
  }
  return null;
};

const checkRegexPresent: CheckEvaluator<"regex_present"> = (check, ctx) => {
  const re = new RegExp(check.pattern, check.flags ?? "");
  if (!re.test(ctx.fullText)) {
    return {
      checkType: "regex_present",
      criterion: check.criterion,
      detail: check.message ?? `Expected pattern /${check.pattern}/${check.flags ?? ""} was not found in the output.`,
    };
  }
  return null;
};

const checkRegexAbsent: CheckEvaluator<"regex_absent"> = (check, ctx) => {
  const re = new RegExp(check.pattern, check.flags ?? "");
  if (re.test(ctx.fullText)) {
    return {
      checkType: "regex_absent",
      criterion: check.criterion,
      detail: check.message ?? `Forbidden pattern /${check.pattern}/${check.flags ?? ""} was found in the output.`,
    };
  }
  return null;
};

const checkMaxWords: CheckEvaluator<"max_words"> = (check, ctx) => {
  const scope = check.scope ?? "whole";
  if (scope === "whole") {
    const wc = wordCount(ctx.output);
    if (wc > check.limit) {
      return { checkType: "max_words", criterion: check.criterion, detail: `Output is ${wc} words; limit is ${check.limit}.` };
    }
    return null;
  }

  const sections = splitSections(ctx.output);
  const over = sections.map((s, i) => ({ index: i + 1, wc: wordCount(s) })).filter((s) => s.wc > check.limit);
  if (over.length > 0) {
    const detail = over.map((s) => `section ${s.index} (${s.wc} words)`).join(", ");
    return { checkType: "max_words", criterion: check.criterion, detail: `Exceeds ${check.limit}-word limit: ${detail}.` };
  }
  return null;
};

const checkCountRange: CheckEvaluator<"count_range"> = (check, ctx) => {
  const re = new RegExp(check.pattern, check.flags ?? "g");
  const count = (ctx.fullText.match(re) ?? []).length;
  if (check.min !== undefined && count < check.min) {
    return { checkType: "count_range", criterion: check.criterion, detail: `Found ${count} matches of /${check.pattern}/; need at least ${check.min}.` };
  }
  if (check.max !== undefined && count > check.max) {
    return { checkType: "count_range", criterion: check.criterion, detail: `Found ${count} matches of /${check.pattern}/; limit is ${check.max}.` };
  }
  return null;
};

const IMPLEMENTED_TYPES = new Set<string>(["section_present", "regex_present", "regex_absent", "max_words", "count_range"]);

export function isImplementedCheckType(type: SkillCheck["type"]): type is ImplementedCheckType {
  return IMPLEMENTED_TYPES.has(type);
}

/** Runs a check whose type has a real evaluator. Unimplemented types (see
 * ImplementedCheckType's doc) return null here — callers should route those
 * to human review via isImplementedCheckType, not treat a null as "passed",
 * see output-gate.ts. A switch (rather than an object keyed by type) lets
 * TypeScript narrow `check` to each variant automatically. */
export function runCheck(check: SkillCheck, ctx: CheckEvalContext): GateFailure | null {
  switch (check.type) {
    case "section_present": return checkSectionPresent(check, ctx);
    case "regex_present": return checkRegexPresent(check, ctx);
    case "regex_absent": return checkRegexAbsent(check, ctx);
    case "max_words": return checkMaxWords(check, ctx);
    case "count_range": return checkCountRange(check, ctx);
    default: return null;
  }
}
