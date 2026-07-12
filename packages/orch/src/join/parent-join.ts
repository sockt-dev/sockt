import type { SqliteTaskStore, FsmEngine } from "@sockt/fsm";
import type { TelemetryEmitter } from "@sockt/types";

/** Prefix AgentRunner uses on the `dependency` string of a blocked outcome
 * when a task delegated via create_task and is waiting on its children —
 * see agent-runner.ts's finalizeCompletion. Shared here so the join logic
 * and the runner agree on the exact shape without importing across the
 * runtime/orch package boundary. */
export const AWAITING_CHILDREN_PREFIX = "awaiting-children:";

/** Appended to a resumed parent's description so a second finalizeCompletion
 * pass (after the architect reclaims it) doesn't try to block-on-children
 * again if it calls create_task once more despite the synthesis directive —
 * the createdByParent dedup Map handles repeat create_task calls with the
 * same description, but a fresh set of genuinely new create_task calls
 * would otherwise re-trigger an infinite blocked/resume loop. */
export const JOIN_MARKER = "[join] All subtasks finished.";

const TERMINAL_STATUSES = new Set(["completed", "escalated", "cancelled"]);

/**
 * Call after any task reaches a terminal state (completed/escalated/cancelled).
 * If that task has a parent currently blocked on "awaiting-children:..." and
 * every one of the parent's children has now also reached a terminal state,
 * append a synthesis directive + all child outputs to the parent's
 * description and resume it (blocked -> pending, owner cleared — the same
 * owner-clearing requirement /retry and /approve already need, since
 * claimStmt requires status='pending' AND owner IS NULL) so the architect
 * reclaims it and produces ONE final reply instead of the children's
 * outputs going nowhere.
 */
export async function maybeResumeParent(
  store: SqliteTaskStore,
  fsm: FsmEngine,
  telemetry: TelemetryEmitter | undefined,
  childId: string,
): Promise<void> {
  const child = await store.get(childId);
  if (!child?.parentId) return;

  const parent = await store.get(child.parentId);
  if (!parent || parent.status !== "blocked" || !parent.output?.startsWith(AWAITING_CHILDREN_PREFIX)) return;

  const siblings = await store.listByParent(parent.id);
  if (siblings.some((s) => !TERMINAL_STATUSES.has(s.status))) return; // still waiting on at least one

  const results = siblings
    .map((s, i) => {
      const snippet = (s.output ?? "(no output)").slice(0, 2000);
      return `[${i + 1}] (${s.status}) ${s.description.slice(0, 100)}:\n${snippet}`;
    })
    .join("\n\n");

  const resumedDescription =
    `${parent.description}\n\n${JOIN_MARKER} Results:\n${results}\n\n` +
    `Synthesize ONE final answer for the user from these results. Do NOT call create_task again.`;

  await store.update(parent.id, { description: resumedDescription });

  try {
    await fsm.transition(parent.id, "blocked", "pending", "system:join");
    await store.update(parent.id, { owner: null });
  } catch {
    // Parent moved out of blocked between our check and now (e.g. a human
    // cancelled it directly) — the description update above is harmless
    // either way, just skip the resume.
    return;
  }

  telemetry?.emit({
    type: "task_children_joined",
    taskId: parent.id,
    tenantId: parent.tenantId,
    data: { childCount: siblings.length },
  });
}
