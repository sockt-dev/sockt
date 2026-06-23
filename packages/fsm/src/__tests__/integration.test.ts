import { test, expect, describe, beforeEach } from "bun:test";
import { FsmEngine } from "../fsm/engine.ts";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { TaskClaimLock } from "../lock/task-claim-lock.ts";
import { createTestDb } from "../util/test-db.ts";
import type { Database } from "bun:sqlite";

let db: Database;
let store: SqliteTaskStore;
let engine: FsmEngine;
let lock: TaskClaimLock;

beforeEach(() => {
  db = createTestDb();
  store = new SqliteTaskStore(db);
  engine = new FsmEngine(store);
  lock = new TaskClaimLock(db);
});

describe("Integration", () => {
  test("full lifecycle: create -> claim -> complete", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Do work",
    });

    const claimed = await lock.attemptClaim(task.id, "agent-1");
    expect(claimed!.status).toBe("in_progress");

    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);

    const completed = await engine.transition(
      task.id,
      "in_progress",
      "completed",
      "agent-1"
    );
    expect(completed.status).toBe("completed");
  });

  test("budget exhaustion triggers escalation", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Heavy work",
      llmCallsBudget: 3,
    });

    await lock.attemptClaim(task.id, "agent-1");
    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);

    const budget = await engine.checkBudget(task.id);
    expect(budget.allowed).toBe(false);
    expect(budget.autoEscalated).toBe(true);

    const task2 = await store.get(task.id);
    expect(task2!.status).toBe("escalated");
  });

  test("blocked -> pending -> in_progress -> completed lifecycle", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Blocked task",
    });

    await engine.transition(task.id, "pending", "in_progress", "agent-1");
    await engine.transition(task.id, "in_progress", "blocked", "agent-1");
    await engine.transition(task.id, "blocked", "pending", "system");
    await engine.transition(task.id, "pending", "in_progress", "agent-2");
    const final = await engine.transition(
      task.id,
      "in_progress",
      "completed",
      "agent-2"
    );

    expect(final.status).toBe("completed");
  });

  test("parent-child hierarchy", async () => {
    const parent = await store.create({
      tenantId: "t1",
      description: "Parent task",
    });
    await store.create({
      tenantId: "t1",
      description: "Child 1",
      parentId: parent.id,
    });
    await store.create({
      tenantId: "t1",
      description: "Child 2",
      parentId: parent.id,
    });
    await store.create({
      tenantId: "t1",
      description: "Child 3",
      parentId: parent.id,
    });

    const children = await store.listByParent(parent.id);
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.parentId === parent.id)).toBe(true);
  });

  test("concurrent claim race with many agents", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Race task",
    });

    const agents = Array.from({ length: 10 }, (_, i) => `agent-${i}`);
    const results = await Promise.all(
      agents.map((agent) => lock.attemptClaim(task.id, agent))
    );

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  test("claim, release, re-claim by different agent", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Pass-around",
    });

    await lock.attemptClaim(task.id, "agent-1");
    await lock.releaseClaim(task.id, "agent-1");

    const reclaimed = await lock.attemptClaim(task.id, "agent-2");
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.owner).toBe("agent-2");
  });

  test("countByStatus reflects state changes", async () => {
    await store.create({ tenantId: "t1", description: "A" });
    await store.create({ tenantId: "t1", description: "B" });
    const c = await store.create({ tenantId: "t1", description: "C" });
    const d = await store.create({ tenantId: "t1", description: "D" });

    await lock.attemptClaim(c.id, "agent-1");
    await engine.transition(d.id, "pending", "cancelled", "system");

    const counts = await store.countByStatus("t1");
    expect(counts.pending).toBe(2);
    expect(counts.in_progress).toBe(1);
    expect(counts.cancelled).toBe(1);
    expect(counts.completed).toBe(0);
  });
});
