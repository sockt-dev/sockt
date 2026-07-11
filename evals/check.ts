#!/usr/bin/env bun
/**
 * Phase 3.1 (see the Phase 3 status section in test-plan.md) — automates the
 * confirmed, objectively-checkable findings from assertions.md as a cheap
 * regression guard over traces.jsonl. Not an eval framework: no LLM calls, no
 * judge, just pattern checks against what actually executed. Run after any
 * change to plan.ts/act.ts/reflect.ts or the department prompts to catch a
 * regression before it needs a full manual eval pass to notice.
 *
 * Usage:
 *   bun run evals/check.ts [path-to-traces.jsonl]
 *
 * Exit code is nonzero if any check found a violation, so this is CI-friendly.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

const traceLogPath = process.argv[2] ?? process.env.TRACE_LOG_PATH ?? `${homedir()}/.sockt/scratch/traces.jsonl`;

// Kept in sync manually with packages/runtime/src/tools/built-in/index.ts —
// there's no shared export of "just the names" to import here without
// constructing a full ToolRegistry, so this list is the tradeoff.
const REGISTERED_TOOL_NAMES = new Set([
  "web_search",
  "write_file",
  "read_file",
  "http_request",
  "create_task",
  "exec_code",
  "ask_user",
]);

// Phrasing that claims a capability-requiring action was taken. Matched
// against completed-task output text. See assertions.md's "New: capability
// hallucination" row — this is the code-checkable half of that finding; an
// LLM judge (Phase 3.1's other half, not built here) would catch subtler
// cases this regex misses.
const CAPABILITY_CLAIM_PATTERN = /\b(email (was |has been )?(sent|delivered)|successfully sent|authentication succeeded|authenticated (as|via)|connection established|tested successfully|restarted (the |)(service|server|postgres|database)|ssh(ed)? (into|to)|logged? in (as|to))\b/i;

interface TraceStep {
  phase: "plan" | "act" | "observe" | "reflect";
  action: string;
  output?: unknown;
  toolCall?: { name: string; arguments: unknown };
}

interface TraceRecord {
  taskId: string;
  tenantId: string;
  agentId: string;
  department?: string;
  steps: TraceStep[];
  outcome?: { status: string; output?: string; reason?: string; dependency?: string; question?: string };
}

interface Finding {
  check: string;
  taskId: string;
  detail: string;
}

async function loadTraces(path: string): Promise<TraceRecord[]> {
  const content = await readFile(path, "utf-8");
  const records: TraceRecord[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      // skip malformed line rather than aborting the whole run
    }
  }
  return records;
}

function checkToolNameGrounding(record: TraceRecord): Finding[] {
  const findings: Finding[] = [];
  for (const step of record.steps) {
    if (step.phase !== "act" || !step.toolCall) continue;
    if (!REGISTERED_TOOL_NAMES.has(step.toolCall.name)) {
      findings.push({
        check: "tool-name-grounding",
        taskId: record.taskId,
        detail: `act phase executed unregistered tool name "${step.toolCall.name}"`,
      });
    }
  }
  return findings;
}

function checkCapabilityHallucination(record: TraceRecord): Finding[] {
  if (record.outcome?.status !== "completed" || !record.outcome.output) return [];

  const match = record.outcome.output.match(CAPABILITY_CLAIM_PATTERN);
  if (!match) return [];

  // Any real tool call anywhere in the trace is treated as a plausible basis
  // for the claim — this check flags the case where NO tool call backs the
  // claim at all, the clearest form of the original finding (e.g. G5's fully
  // fabricated "Email campaign successfully sent" with no send-email tool
  // ever existing, let alone being called).
  const hasAnyToolCall = record.steps.some((s) => s.phase === "act" && s.toolCall);
  if (!hasAnyToolCall) {
    return [{
      check: "capability-hallucination",
      taskId: record.taskId,
      detail: `output claims "${match[0]}" but no tool was called anywhere in the trace`,
    }];
  }
  return [];
}

function checkArchitectDecomposition(record: TraceRecord): Finding[] {
  if (!record.agentId.includes("architect")) return [];
  const createTaskCalls = record.steps.filter(
    (s) => s.phase === "act" && s.toolCall?.name === "create_task",
  ).length;
  if (createTaskCalls === 0) {
    return [{
      check: "architect-decomposition",
      taskId: record.taskId,
      detail: "architect task made zero create_task calls — informational only, may be a genuinely single-step request",
    }];
  }
  return [];
}

async function main() {
  let records: TraceRecord[];
  try {
    records = await loadTraces(traceLogPath);
  } catch (err) {
    console.error(`Could not read ${traceLogPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Loaded ${records.length} trace record(s) from ${traceLogPath}\n`);

  const hardFindings: Finding[] = [];
  const infoFindings: Finding[] = [];

  for (const record of records) {
    hardFindings.push(...checkToolNameGrounding(record));
    hardFindings.push(...checkCapabilityHallucination(record));
    infoFindings.push(...checkArchitectDecomposition(record));
  }

  const byCheck = new Map<string, Finding[]>();
  for (const f of [...hardFindings, ...infoFindings]) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }

  for (const [check, findings] of byCheck) {
    console.log(`## ${check} (${findings.length})`);
    for (const f of findings.slice(0, 20)) {
      console.log(`  - ${f.taskId.slice(0, 8)}: ${f.detail}`);
    }
    if (findings.length > 20) console.log(`  ... and ${findings.length - 20} more`);
    console.log("");
  }

  console.log(`${hardFindings.length} hard finding(s) (tool-name-grounding, capability-hallucination), ${infoFindings.length} informational finding(s) (architect-decomposition, not a failure by itself)`);

  if (hardFindings.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
