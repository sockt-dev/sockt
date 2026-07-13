import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore, FsmEngine, createTestDb } from "@sockt/fsm";
import type { Database } from "bun:sqlite";
import { maybeResumeParent, AWAITING_CHILDREN_PREFIX, JOIN_MARKER } from "../join/parent-join.ts";

describe("maybeResumeParent", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let fsm: FsmEngine;
  let events: unknown[];
  let telemetry: { emit: (e: unknown) => void; flush: () => Promise<void> };

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteTaskStore(db);
    fsm = new FsmEngine(store);
    events = [];
    telemetry = { emit: (e) => events.push(e), flush: async () => {} };
  });

  async function blockedParentWithChildren(childCount: number) {
    const parent = await store.create({ tenantId: "t1", description: "Run a full campaign" });
    await store.claim(parent.id, "growth-architect-1");

    const children = [];
    for (let i = 0; i < childCount; i++) {
      children.push(await store.create({ tenantId: "t1", description: `Deliverable ${i + 1}`, parentId: parent.id }));
    }

    await fsm.transition(parent.id, "in_progress", "blocked", "growth-architect-1");
    await store.update(parent.id, { output: `${AWAITING_CHILDREN_PREFIX}${children.map((c) => c.id).join(",")}` });

    return { parent, children };
  }

  test("does nothing while any child is still non-terminal", async () => {
    const { parent, children } = await blockedParentWithChildren(2);
    await store.claim(children[0]!.id, "growth-worker-1");
    await store.update(children[0]!.id, { status: "completed", output: "leads.csv" });
    // children[1] is still pending

    await maybeResumeParent(store, telemetry, children[0]!.id);

    const stillBlocked = await store.get(parent.id);
    expect(stillBlocked?.status).toBe("blocked");
    expect(events).toHaveLength(0);
  });

  test("resumes the parent once every child is terminal, appending results and clearing owner", async () => {
    const { parent, children } = await blockedParentWithChildren(2);

    await store.claim(children[0]!.id, "growth-worker-1");
    await store.update(children[0]!.id, { status: "completed", output: "10 qualified leads" });

    await store.claim(children[1]!.id, "growth-worker-2");
    await fsm.transition(children[1]!.id, "in_progress", "escalated", "growth-worker-2");
    await store.update(children[1]!.id, { output: "could not find any results" });

    await maybeResumeParent(store, telemetry, children[1]!.id);

    const resumed = await store.get(parent.id);
    expect(resumed?.status).toBe("pending");
    expect(resumed?.owner).toBeNull();
    expect(resumed?.description).toContain(JOIN_MARKER);
    expect(resumed?.description).toContain("10 qualified leads");
    expect(resumed?.description).toContain("could not find any results");
    expect(resumed?.description).toContain("Synthesize ONE final answer");

    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("task_children_joined");
  });

  test("re-claiming the resumed parent works (owner was actually cleared)", async () => {
    const { parent, children } = await blockedParentWithChildren(1);
    await store.claim(children[0]!.id, "growth-worker-1");
    await store.update(children[0]!.id, { status: "completed", output: "done" });

    await maybeResumeParent(store, telemetry, children[0]!.id);

    const reclaimed = await store.claim(parent.id, "growth-architect-1");
    expect(reclaimed.owner).toBe("growth-architect-1");
  });

  test("does nothing when the completed task has no parent", async () => {
    const orphan = await store.create({ tenantId: "t1", description: "Standalone task" });
    await store.claim(orphan.id, "agent-1");
    await store.update(orphan.id, { status: "completed", output: "done" });

    await maybeResumeParent(store, telemetry, orphan.id);
    expect(events).toHaveLength(0);
  });

  test("two concurrent resume attempts for the same parent don't double-append the join block", async () => {
    // Regression test for a race: both calls read the parent while it's
    // still 'blocked' (interleaved before either writes), then both attempt
    // to resume. Only one should actually win — resumeIfBlocked's atomic
    // UPDATE...WHERE status='blocked' means the second call's write affects
    // zero rows instead of overwriting the first call's already-joined
    // description with a second synthesis block.
    const { parent, children } = await blockedParentWithChildren(2);
    await store.claim(children[0]!.id, "growth-worker-1");
    await store.update(children[0]!.id, { status: "completed", output: "10 qualified leads" });
    await store.claim(children[1]!.id, "growth-worker-2");
    await store.update(children[1]!.id, { status: "completed", output: "20 more leads" });

    // Both calls run concurrently against the same already-all-terminal state.
    await Promise.all([
      maybeResumeParent(store, telemetry, children[0]!.id),
      maybeResumeParent(store, telemetry, children[1]!.id),
    ]);

    const resumed = await store.get(parent.id);
    expect(resumed?.status).toBe("pending");
    expect(resumed?.owner).toBeNull();
    // Exactly one JOIN_MARKER block, not two.
    const occurrences = (resumed?.description.match(new RegExp(JOIN_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    expect(occurrences).toBe(1);
    expect(events).toHaveLength(1);
  });

  test("does nothing when the parent is not blocked-on-children (e.g. a normal blocked HITL task)", async () => {
    const parent = await store.create({ tenantId: "t1", description: "Some task" });
    await store.claim(parent.id, "agent-1");
    await fsm.transition(parent.id, "in_progress", "blocked", "agent-1");
    await store.update(parent.id, { output: "HITL denied: exec_code" }); // not an awaiting-children dependency

    const child = await store.create({ tenantId: "t1", description: "Unrelated child", parentId: parent.id });
    await store.claim(child.id, "agent-2");
    await store.update(child.id, { status: "completed", output: "done" });

    await maybeResumeParent(store, telemetry, child.id);

    const stillBlocked = await store.get(parent.id);
    expect(stillBlocked?.status).toBe("blocked");
    expect(stillBlocked?.output).toBe("HITL denied: exec_code");
  });
});
