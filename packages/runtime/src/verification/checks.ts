import type { SkillCheck } from "../types.ts";
import type { GateFailure } from "./output-gate.ts";
import type { ToolEvidence } from "./evidence.ts";

/** Types with a real evaluator below — all ten non-human_review SkillCheck
 * variants now have one, added across Phase 2 (structural checks) and
 * Phase 3 (department-specific evaluators below). */
export type ImplementedCheckType =
  | "section_present" | "regex_present" | "regex_absent" | "max_words" | "count_range"
  | "lead_provenance" | "computed_number" | "metric_sourcing" | "grounded_quotes" | "evidence_citation";

type CheckOfType<T extends SkillCheck["type"]> = Extract<SkillCheck, { type: T }>;

export interface CheckEvalContext {
  /** output + artifacts, joined with a blank line — what structural checks
   * (sections, presence/absence patterns, counts) run against. */
  fullText: string;
  /** reflection output alone — what message-shaped checks (word limits on
   * the actual reply) run against. */
  output: string;
  /** Real tool-call evidence from this run — what provenance/sourcing/
   * citation checks cross-reference claims against. */
  evidence: ToolEvidence;
  /** The task's original description — the other legitimate source a claim
   * can be "backed by" (user-provided data, not just tool output). */
  taskDescription: string;
}

type CheckEvaluator<T extends SkillCheck["type"]> = (check: CheckOfType<T>, ctx: CheckEvalContext) => GateFailure | null;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "was", "were", "be", "been", "that", "this", "it", "as", "by", "at", "from", "are", "not", "will"]);

function contentTokens(text: string): string[] {
  return normalizeWords(text).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

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

// ─── §4.1 lead_provenance ────────────────────────────────────────────────────

const TABLE_ROW_RE = /^\|.+\|$/;
const TABLE_SEPARATOR_RE = /^\|[\s:|-]+\|$/;
const NUMBERED_LEAD_RE = /^\s*\d+\.\s/;
const URL_TOKEN_RE = /https?:\/\/[^\s")\]}>]+/g;
const EMAIL_RE = /[\w.+-]+@([\w-]+\.[\w.-]+)/;
const EMAIL_RE_G = /[\w.+-]+@([\w-]+\.[\w.-]+)/g;

// A lead "row" is a markdown table row or numbered list line that plausibly
// names a contact — has an email, a LinkedIn URL, or a company-suffix token.
function extractLeadRows(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (TABLE_SEPARATOR_RE.test(trimmed)) return false;
    if (TABLE_ROW_RE.test(trimmed) || NUMBERED_LEAD_RE.test(trimmed)) {
      return /@|linkedin\.com/i.test(trimmed) || /\b(?:Inc|LLC|Corp|Co\.|Ltd)\b/i.test(trimmed);
    }
    return false;
  });
}

function emailDomainsIn(text: string): Set<string> {
  const domains = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE_G)) domains.add(m[1]!.toLowerCase());
  return domains;
}

const checkLeadProvenance: CheckEvaluator<"lead_provenance"> = (check, ctx) => {
  const rows = extractLeadRows(ctx.fullText);
  if (rows.length === 0) {
    return { checkType: "lead_provenance", criterion: check.criterion, detail: "No lead rows found — expected a markdown table or numbered list with an email or LinkedIn URL per lead." };
  }
  if (!ctx.evidence.hasToolCall("web_search") && ctx.evidence.urls.size === 0) {
    return { checkType: "lead_provenance", criterion: check.criterion, detail: "No web_search/http_request results back this lead list. Run real searches or escalate." };
  }

  const backedDomains = emailDomainsIn(ctx.evidence.text);
  const unbacked = rows.filter((row) => {
    const rowUrls = row.match(URL_TOKEN_RE) ?? [];
    const backedByUrl = rowUrls.some((u) => ctx.evidence.urls.has(u));
    const rowEmail = row.match(EMAIL_RE);
    const backedByEmail = rowEmail ? backedDomains.has(rowEmail[1]!.toLowerCase()) : false;
    return !backedByUrl && !backedByEmail;
  });

  if (unbacked.length > 0) {
    const listed = unbacked.slice(0, 5).map((r) => `'${r.trim()}'`).join(", ");
    return {
      checkType: "lead_provenance",
      criterion: check.criterion,
      detail: `Lead row(s) have no tool-result-backed source: ${listed} — drop them or re-search; do not invent contacts.`,
    };
  }
  return null;
};

// ─── §4.3 computed_number ────────────────────────────────────────────────────

const checkComputedNumber: CheckEvaluator<"computed_number"> = (check, ctx) => {
  const re = new RegExp(`${check.labelPattern}[^\\d-]{0,30}(-?\\d[\\d,.]*)`, "i");
  const claim = ctx.fullText.match(re);
  if (!claim) return null; // nothing claimed under this label — nothing to verify

  const stated = claim[1]!.replace(/,/g, "");
  if (!ctx.evidence.hasToolCall("exec_code")) {
    return {
      checkType: "computed_number",
      criterion: check.criterion,
      detail: `A labeled metric ("${check.labelPattern}") was stated without computing it. Re-do the arithmetic in exec_code (python) and state exactly the computed number.`,
    };
  }

  const statedNum = Number.parseFloat(stated);
  const stdoutNumbers = (ctx.evidence.execStdout.match(/-?\d[\d,.]*/g) ?? []).map((n) => Number.parseFloat(n.replace(/,/g, "")));
  const tolerance = Math.max(0.005, Math.abs(statedNum) * 0.005);
  const matches = stdoutNumbers.some((n) => Math.abs(n - statedNum) <= tolerance);
  if (!matches) {
    return {
      checkType: "computed_number",
      criterion: check.criterion,
      detail: `Stated value ${stated} does not match any number in the exec_code output — recompute and report the actual computed value.`,
    };
  }
  return null;
};

// ─── §3.2 / §5.3 metric_sourcing ─────────────────────────────────────────────

const METRIC_CLAIM_RE = /\b\d[\d,.]*\s*%|\$\s?\d[\d,.]*|\b(MAU|DAU|MRR|ARR|LTV|CAC|churn|NPS|conversion)\b[^.\n]{0,40}\d/i;
const ASSUMPTION_RE = /\bASSUMPTION\b|\bassum(?:ed|ption|ing)\b|\bestimate/i;
const NUMBER_TOKEN_RE = /-?\d[\d,]*(?:\.\d+)?/g;

/** Exported directly (not just via the dispatch table) because it's also
 * run as an always-on, department-wide built-in for `department === "product"`
 * regardless of skill — see output-gate.ts. */
export function findUnsourcedMetricClaim(output: string, evidence: ToolEvidence, taskDescription: string): GateFailure | null {
  const sentences = splitSentences(output);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    if (!METRIC_CLAIM_RE.test(sentence)) continue;

    const neighborhood = [sentences[i - 1], sentence, sentences[i + 1]].filter(Boolean).join(" ");
    if (ASSUMPTION_RE.test(neighborhood)) continue;

    const numbers = sentence.match(NUMBER_TOKEN_RE) ?? [];
    const backed = numbers.some((n) => {
      const normalized = n.replace(/,/g, "");
      return evidence.numbers.has(normalized) || taskDescription.includes(normalized) || taskDescription.includes(n);
    });
    if (backed) continue;

    return {
      checkType: "metric_sourcing",
      criterion: "Every stated metric is sourced or labeled as an assumption",
      detail: `Metric claim '${sentence}' cites no tool result and no input data — either cite the source or prefix with 'ASSUMPTION:'`,
    };
  }
  return null;
}

const checkMetricSourcing: CheckEvaluator<"metric_sourcing"> = (check, ctx) => {
  const failure = findUnsourcedMetricClaim(ctx.output, ctx.evidence, ctx.taskDescription);
  return failure ? { ...failure, criterion: check.criterion } : null;
};

// ─── §5.4 grounded_quotes ────────────────────────────────────────────────────

function extractQuoteSpans(text: string): string[] {
  const spans: string[] = [];
  for (const m of text.matchAll(/["“]([^"”]{10,})["”]/g)) spans.push(m[1]!.trim());
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^[>-]\s+/.test(t)) {
      const body = t.replace(/^[>-]\s+/, "");
      if (body.split(/\s+/).length >= 5) spans.push(body);
    }
  }
  return spans;
}

function hasConsecutiveOverlap(spanWords: string[], targetWords: string[], minLen: number): boolean {
  if (spanWords.length < minLen) return false;
  const target = targetWords.join(" ");
  for (let i = 0; i + minLen <= spanWords.length; i++) {
    if (target.includes(spanWords.slice(i, i + minLen).join(" "))) return true;
  }
  return false;
}

const checkGroundedQuotes: CheckEvaluator<"grounded_quotes"> = (check, ctx) => {
  const minQuotes = check.minQuotes ?? 3;
  const spans = extractQuoteSpans(ctx.taskDescription);
  if (spans.length < minQuotes) {
    // Can't demand grounding in verbatim feedback that was never provided —
    // downgrade to a warning rather than blocking on an impossible bar.
    return { checkType: "grounded_quotes", criterion: check.criterion, detail: "Input contained no verbatim feedback to ground against.", severity: "warn" };
  }

  const outputWords = normalizeWords(ctx.fullText);
  const grounded = spans.filter((span) => hasConsecutiveOverlap(normalizeWords(span), outputWords, 6));
  if (grounded.length < minQuotes) {
    return {
      checkType: "grounded_quotes",
      criterion: check.criterion,
      detail: "Research synthesis does not reference the actual input feedback — quote the real user statements, not generic prose.",
    };
  }
  return null;
};

// ─── §6.2 evidence_citation ──────────────────────────────────────────────────

const checkEvidenceCitation: CheckEvaluator<"evidence_citation"> = (check, ctx) => {
  const minOverlap = check.minOverlapTokens ?? 4;
  const claimRe = new RegExp(check.claimPattern, "i");
  const groundTokens = new Set(contentTokens(`${ctx.taskDescription} ${ctx.evidence.text}`));

  for (const sentence of splitSentences(ctx.output)) {
    if (!claimRe.test(sentence)) continue;
    const overlap = contentTokens(sentence).filter((t) => groundTokens.has(t)).length;
    if (overlap < minOverlap) {
      return {
        checkType: "evidence_citation",
        criterion: check.criterion,
        detail: `Causal claim '${sentence.trim()}' cites evidence not present in the task input or any tool result — do not invent log lines, config changes, or hardware failures. State only what the input/tools show, or say what data you'd need.`,
      };
    }
  }
  return null;
};

const IMPLEMENTED_TYPES = new Set<string>([
  "section_present", "regex_present", "regex_absent", "max_words", "count_range",
  "lead_provenance", "computed_number", "metric_sourcing", "grounded_quotes", "evidence_citation",
]);

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
    case "lead_provenance": return checkLeadProvenance(check, ctx);
    case "computed_number": return checkComputedNumber(check, ctx);
    case "metric_sourcing": return checkMetricSourcing(check, ctx);
    case "grounded_quotes": return checkGroundedQuotes(check, ctx);
    case "evidence_citation": return checkEvidenceCitation(check, ctx);
    default: return null;
  }
}
