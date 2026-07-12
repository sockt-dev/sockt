export const DEFAULT_READONLY_PATTERNS: RegExp[] = [
  /^(grep|egrep|rg|zgrep)\b/,
  /^(cat|head|tail|less|wc|cut|sort|uniq)\b/,
  /^(ls|find|stat|file|du|df|pwd)\b/,
  /^(ps|top -b|uptime|free|vmstat|iostat)\b/,
  /^journalctl\b(?!.*--vacuum)/,
  /^systemctl (status|show|list-units|is-active)\b/,
  /^docker (ps|logs|inspect|stats|images)\b/,
  /^kubectl (get|describe|logs|top)\b/,
  /^git (log|status|diff|show|branch)\b/,
  /^(dig|nslookup|host|ping -c)\b/,
  /^curl\b(?=.*(-I|--head))(?!.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\b|-F\b))/,
  /^(echo|printf|date|whoami|hostname|env$|uname)\b/,
];

// A single `|` pipe between two read-only commands is fine (each side is
// validated separately below) — `>`/`>>` redirects, and a short blocklist of
// mutating binaries, are never allowed regardless of what pattern a segment
// otherwise matches, so a clever `grep foo > /etc/passwd` doesn't sneak past
// pattern-matching alone.
const MUTATION_TOKENS = /[>]|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bchown\b|\bkill\b|\btee\b|\bsed\s+-i\b/;

function extraPatterns(): RegExp[] {
  const raw = process.env.ENGOPS_READONLY_EXTRA;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((source) => new RegExp(source));
}

function isReadOnlyLine(line: string, patterns: RegExp[]): boolean {
  if (MUTATION_TOKENS.test(line)) return false;
  // Split on `|` (pipe) and `&&`/`;` (sequencing) — every resulting segment
  // must itself be a read-only command.
  const segments = line.split(/\|\||&&|;|\|(?!\|)/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => patterns.some((p) => p.test(segment)));
}

/**
 * True only when EVERY command line in an exec_code bash/sh snippet matches
 * a read-only pattern and contains no write/redirect/mutation token.
 * Fail-closed: unknown tool, non-shell language, parse ambiguity, or any
 * unmatched line -> false. See docs/ARCHITECTURE.md's HITL section for how
 * this is wired into AgentRunner's approval-gate check.
 */
export function isReadOnlyExec(toolName: string, args: Record<string, unknown>): boolean {
  if (process.env.HITL_READONLY_BYPASS === "false") return false;
  if (toolName !== "exec_code") return false;

  const language = String(args.language ?? "").toLowerCase();
  if (language !== "bash" && language !== "sh" && language !== "shell") return false;

  const code = String(args.code ?? "");
  if (!code.trim()) return false;

  const patterns = [...DEFAULT_READONLY_PATTERNS, ...extraPatterns()];
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) return false;
  return lines.every((line) => isReadOnlyLine(line, patterns));
}
