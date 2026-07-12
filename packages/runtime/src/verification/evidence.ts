import type { ExecutionTrace } from "../trace/execution-trace.ts";

export interface ToolEvidence {
  urls: Set<string>;
  numbers: Set<string>;
  text: string;
  execStdout: string;
  hasToolCall(name: string): boolean;
}

const URL_PATTERN = /https?:\/\/[^\s")\]}>]+/g;
// Strips thousands-separator commas ("10,000" -> "10000") but keeps a
// leading sign and a decimal point, since those change the value's meaning.
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output ?? "");
  } catch {
    return String(output);
  }
}

function extractStdout(output: unknown): string {
  if (output && typeof output === "object" && "stdout" in output) {
    const stdout = (output as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? stdout : "";
  }
  return "";
}

/** Every URL / numeric token appearing in any successful act-step tool
 * output, plus raw exec_code stdout — the evidence base that the
 * provenance/metric-sourcing/evidence-citation checks cross-reference
 * against claims in the final output. Only act steps with a toolCall are
 * counted, so narrated LLM output (act.ts's non-tool fallback) never counts
 * as evidence of anything actually having been done. */
export function collectToolEvidence(trace: ExecutionTrace): ToolEvidence {
  const toolSteps = trace.getSteps().filter((s) => s.phase === "act" && s.toolCall);

  const textParts: string[] = [];
  const execStdoutParts: string[] = [];
  const toolNames = new Set<string>();

  for (const step of toolSteps) {
    toolNames.add(step.toolCall!.name);
    const text = stringifyOutput(step.output);
    textParts.push(text);
    if (step.toolCall!.name === "exec_code") {
      const stdout = extractStdout(step.output);
      if (stdout) execStdoutParts.push(stdout);
    }
  }

  const text = textParts.join("\n");
  const urls = new Set(text.match(URL_PATTERN) ?? []);
  const numbers = new Set(
    (text.match(NUMBER_PATTERN) ?? [])
      .map((n) => n.replace(/,/g, ""))
      .filter((n) => n !== "" && n !== "-" && n !== "."),
  );

  return {
    urls,
    numbers,
    text,
    execStdout: execStdoutParts.join("\n"),
    hasToolCall: (name: string) => toolNames.has(name),
  };
}
