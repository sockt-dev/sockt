#!/usr/bin/env bun
/**
 * Pulls together everything Sockt actually has on disk/in the orchestrator
 * about one task and writes a markdown trace file for manual eval review.
 *
 * Usage:
 *   bun run evals/trace-capture.ts <taskId> [label]
 *   bun run evals/trace-capture.ts latest [label]      # most recently updated task
 *
 * Env (same conventions as the rest of the codebase):
 *   ORCH_URL         default http://localhost:3100
 *   DEPLOYMENT_ID    default "default"
 *   TRACE_LOG_PATH   default ~/.sockt/scratch/traces.jsonl (must match what
 *                    packages/runtime/src/serve.ts was started with)
 *
 * Known gap (see evals/README.md): the orchestrator does not store a full
 * FSM transition history, only current status + createdAt/updatedAt. Section
 * B below reports what's actually available, not an invented timeline.
 * Section A (Slack trigger) and D (Slack outcome) cannot be pulled
 * programmatically — Slack API polling is out of scope for this script — and
 * are left as fill-in-manually stubs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

const orchUrl = process.env.ORCH_URL ?? "http://localhost:3100";
const tenantId = process.env.DEPLOYMENT_ID ?? "default";
// process.env.HOME is unset under PowerShell on Windows (only USERPROFILE is set) —
// use os.homedir() so this resolves the same way regardless of shell.
const traceLogPath =
  process.env.TRACE_LOG_PATH ?? `${homedir()}/.sockt/scratch/traces.jsonl`;

interface Task {
  id: string;
  tenantId: string;
  status: string;
  owner: string | null;
  parentId: string | null;
  description: string;
  output: string | null;
  llmCallsUsed: number;
  llmCallsBudget: number;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

async function fetchTask(id: string): Promise<Task> {
  const res = await fetch(`${orchUrl}/tasks/${id}`);
  if (!res.ok) throw new Error(`GET /tasks/${id} -> ${res.status}`);
  return res.json() as Promise<Task>;
}

async function fetchAllTasks(): Promise<Task[]> {
  const res = await fetch(`${orchUrl}/tasks?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) throw new Error(`GET /tasks -> ${res.status}`);
  return res.json() as Promise<Task[]>;
}

async function findLatestTaskId(): Promise<string> {
  const all = await fetchAllTasks();
  if (all.length === 0) throw new Error(`No tasks found for tenant "${tenantId}"`);
  all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return all[0]!.id;
}

async function findChildren(taskId: string): Promise<Task[]> {
  const all = await fetchAllTasks();
  return all.filter((t) => t.parentId === taskId);
}

interface TraceRecord {
  taskId: string;
  tenantId: string;
  agentId: string;
  department?: string;
  steps: unknown[];
  outcome: unknown;
  durationMs: number;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

async function findTraceRecords(taskIds: string[]): Promise<Map<string, TraceRecord>> {
  const found = new Map<string, TraceRecord>();
  let content: string;
  try {
    content = await readFile(traceLogPath, "utf-8");
  } catch {
    return found; // no trace log yet — runtime may not have TRACE_LOG_PATH set, or task hasn't finished
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as TraceRecord;
      if (taskIds.includes(record.taskId)) found.set(record.taskId, record);
    } catch {
      // skip malformed line rather than aborting the whole capture
    }
  }
  return found;
}

function renderTaskTable(task: Task): string {
  return [
    "| Field | Value |",
    "|---|---|",
    `| id | \`${task.id}\` |`,
    `| status | **${task.status}** |`,
    `| owner | ${task.owner ?? "_unclaimed_"} |`,
    `| llmCallsUsed / Budget | ${task.llmCallsUsed} / ${task.llmCallsBudget} |`,
    `| attemptCount / maxAttempts | ${task.attemptCount} / ${task.maxAttempts} |`,
    `| createdAt | ${task.createdAt} |`,
    `| updatedAt | ${task.updatedAt} |`,
    `| output | ${task.output ? "see below" : "_none_"} |`,
  ].join("\n");
}

function renderTraceSteps(record: TraceRecord | undefined): string {
  if (!record) {
    return "_No execution trace found in traces.jsonl for this task — either TRACE_LOG_PATH wasn't set when the runtime worker ran, or the task hasn't reached a terminal state yet._";
  }
  const lines: string[] = [
    `Agent: \`${record.agentId}\` (department: ${record.department ?? "?"}) · duration: ${Math.round(record.durationMs)}ms · tokens: ${record.tokenUsage?.totalTokens ?? "?"}`,
    "",
  ];
  for (const step of record.steps as Array<{ phase: string; action: string; output?: unknown; toolCall?: { name: string; arguments: unknown } }>) {
    lines.push(`**[${step.phase}]** ${step.action}`);
    if (step.toolCall) {
      lines.push(`  - tool: \`${step.toolCall.name}\` args: \`${JSON.stringify(step.toolCall.arguments)}\``);
    }
    const out = typeof step.output === "string" ? step.output : JSON.stringify(step.output);
    lines.push("  ```");
    lines.push("  " + (out ?? "").slice(0, 2000).split("\n").join("\n  "));
    lines.push("  ```");
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const [idArg, labelArg] = process.argv.slice(2);
  if (!idArg) {
    console.error("Usage: bun run evals/trace-capture.ts <taskId|latest> [label]");
    process.exit(1);
  }

  const taskId = idArg === "latest" ? await findLatestTaskId() : idArg;
  const task = await fetchTask(taskId);
  const children = await findChildren(taskId);
  const allIds = [taskId, ...children.map((c) => c.id)];
  const traces = await findTraceRecords(allIds);

  const label = labelArg ?? taskId.slice(0, 8);
  const outDir = new URL("./traces/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  await mkdir(outDir, { recursive: true });
  const outPath = `${outDir}${label}.md`;

  const md = `# Trace: ${label}

verdict:        <!-- Pass | Fail -->
first_wrong:    <!-- one sentence, only if Fail -->

## A. Trigger (fill in manually from Slack)

- Timestamp:
- Channel:
- Message ts (thread id):
- Message text (verbatim):
- Routing rule expected to fire:

## B. Orchestrator state

### Parent task

${renderTaskTable(task)}

**Output:**
\`\`\`
${task.output ?? "(none)"}
\`\`\`

${children.length > 0 ? `### Child tasks (${children.length})\n\n` + children.map((c) => renderTaskTable(c) + `\n\n**Output:**\n\`\`\`\n${c.output ?? "(none)"}\n\`\`\``).join("\n\n") : "_No child tasks — architect did not decompose (or this is a worker-only task)._"}

## C. Agent execution trace

### Parent

${renderTraceSteps(traces.get(taskId))}

${children.map((c) => `### Child: ${c.id.slice(0, 8)}\n\n${renderTraceSteps(traces.get(c.id))}`).join("\n\n")}

## D. Slack outcome (fill in manually)

- Reply appeared: <!-- yes/no -->
- Reply thread correct: <!-- yes/no -->
- Reply latency:
- Reply text:
- Notes:
`;

  await writeFile(outPath, md, "utf-8");
  console.log(`Wrote ${outPath}`);
  console.log(`Task status: ${task.status} | children: ${children.length} | trace records found: ${traces.size}/${allIds.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
