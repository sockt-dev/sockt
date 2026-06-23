import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { FsmEngine } from "../fsm/engine.ts";
import { TaskClaimLock } from "../lock/task-claim-lock.ts";
import { createTestDb } from "../util/test-db.ts";
import { TaskStoreError } from "@sockt/types";
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

describe("Store edge cases", () => {
  test("handles unicode characters in description", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Task with 日本語, émojis 🚀, and ñ characters",
    });
    const fetched = await store.get(task.id);
    expect(fetched!.description).toBe(
      "Task with 日本語, émojis 🚀, and ñ characters"
    );
  });

  test("handles very long description", async () => {
    const longDesc = "x".repeat(10000);
    const task = await store.create({ tenantId: "t1", description: longDesc });
    const fetched = await store.get(task.id);
    expect(fetched!.description).toBe(longDesc);
    expect(fetched!.description.length).toBe(10000);
  });

  test("handles empty string description", async () => {
    const task = await store.create({ tenantId: "t1", description: "" });
    const fetched = await store.get(task.id);
    expect(fetched!.description).toBe("");
  });

  test("handles special SQL characters in description", async () => {
    const dangerous = "'; DROP TABLE tasks; --";
    const task = await store.create({ tenantId: "t1", description: dangerous });
    const fetched = await store.get(task.id);
    expect(fetched!.description).toBe(dangerous);

    const all = await store.listPending("t1");
    expect(all).toHaveLength(1);
  });

  test("setting output to null after it was set", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await store.update(task.id, { output: "some result" });
    const withOutput = await store.get(task.id);
    expect(withOutput!.output).toBe("some result");

    await store.update(task.id, { output: null });
    const cleared = await store.get(task.id);
    expect(cleared!.output).toBeNull();
  });

  test("setting owner to null after it was set", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await store.update(task.id, { owner: "agent-1" });
    expect((await store.get(task.id))!.owner).toBe("agent-1");

    await store.update(task.id, { owner: null });
    expect((await store.get(task.id))!.owner).toBeNull();
  });

  test("multiple sequential updates maintain consistency", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });

    await store.update(task.id, { status: "in_progress" });
    await store.update(task.id, { owner: "agent-1" });
    await store.update(task.id, { output: "partial" });
    await store.update(task.id, { attemptCount: 1 });

    const final = await store.get(task.id);
    expect(final!.status).toBe("in_progress");
    expect(final!.owner).toBe("agent-1");
    expect(final!.output).toBe("partial");
    expect(final!.attemptCount).toBe(1);
  });

  test("multi-field patch applies atomically", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await store.update(task.id, {
      status: "in_progress",
      owner: "agent-1",
      output: "working",
      attemptCount: 2,
    });

    const fetched = await store.get(task.id);
    expect(fetched!.status).toBe("in_progress");
    expect(fetched!.owner).toBe("agent-1");
    expect(fetched!.output).toBe("working");
    expect(fetched!.attemptCount).toBe(2);
  });

  test("incrementLlmCalls past budget still increments", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 2,
    });

    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);
    const result = await store.incrementLlmCalls(task.id);

    expect(result.remaining).toBe(-1);
    const fetched = await store.get(task.id);
    expect(fetched!.llmCallsUsed).toBe(3);
  });

  test("listPending returns empty array for unknown tenant", async () => {
    const result = await store.listPending("non-existent-tenant");
    expect(result).toEqual([]);
  });

  test("listByParent returns empty array for unknown parent", async () => {
    const result = await store.listByParent("non-existent-parent");
    expect(result).toEqual([]);
  });

  test("listByOwner returns empty array for unknown owner", async () => {
    const result = await store.listByOwner("non-existent-owner");
    expect(result).toEqual([]);
  });

  test("countByStatus returns all zeros for unknown tenant", async () => {
    const counts = await store.countByStatus("non-existent");
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(0);
    expect(counts.completed).toBe(0);
    expect(counts.escalated).toBe(0);
    expect(counts.blocked).toBe(0);
    expect(counts.cancelled).toBe(0);
  });

  test("tasks are isolated between tenants", async () => {
    await store.create({ tenantId: "t1", description: "T1 task" });
    await store.create({ tenantId: "t2", description: "T2 task" });

    const t1Pending = await store.listPending("t1");
    const t2Pending = await store.listPending("t2");
    expect(t1Pending).toHaveLength(1);
    expect(t2Pending).toHaveLength(1);
    expect(t1Pending[0]!.description).toBe("T1 task");
    expect(t2Pending[0]!.description).toBe("T2 task");
  });

  test("deleting parent does not cascade to children (FK is not ON DELETE CASCADE)", async () => {
    const parent = await store.create({
      tenantId: "t1",
      description: "Parent",
    });
    const child = await store.create({
      tenantId: "t1",
      description: "Child",
      parentId: parent.id,
    });

    // SQLite foreign_keys are off by default — delete should work
    await store.delete(parent.id);
    const childAfter = await store.get(child.id);
    expect(childAfter).not.toBeNull();
    expect(childAfter!.parentId).toBe(parent.id);
  });

  test("each task gets a unique UUIDv7 id", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const task = await store.create({ tenantId: "t1", description: `Task ${i}` });
      ids.add(task.id);
    }
    expect(ids.size).toBe(100);
  });

  test("UUIDv7 ids are time-sortable", async () => {
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push(await store.create({ tenantId: "t1", description: `Task ${i}` }));
    }

    const ids = tasks.map((t) => t.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test("update with llmCallsUsed directly via patch", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 10,
    });
    await store.update(task.id, { llmCallsUsed: 7 });
    const fetched = await store.get(task.id);
    expect(fetched!.llmCallsUsed).toBe(7);
  });

  test("claim updates updatedAt", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await new Promise((r) => setTimeout(r, 5));
    const claimed = await store.claim(task.id, "agent-1");
    expect(claimed.updatedAt).not.toBe(task.createdAt);
  });

  test("delete on already-deleted task throws", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await store.delete(task.id);
    expect(store.delete(task.id)).rejects.toThrow(TaskStoreError);
  });
});

describe("FSM edge cases", () => {
  test("self-transition is invalid for all states", async () => {
    const statuses = [
      "pending",
      "in_progress",
      "completed",
      "escalated",
      "blocked",
      "cancelled",
    ] as const;

    for (const status of statuses) {
      expect(engine.canTransition(status, status)).toBe(false);
    }
  });

  test("transition with correct from but task was already transitioned", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });

    // First transition succeeds
    await engine.transition(task.id, "pending", "in_progress", "agent-1");

    // Second transition with stale 'from' fails
    expect(
      engine.transition(task.id, "pending", "cancelled", "agent-2")
    ).rejects.toThrow(TaskStoreError);
  });

  test("escalated -> pending -> in_progress -> escalated cycle", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Retry loop",
    });

    await engine.transition(task.id, "pending", "in_progress", "agent-1");
    await engine.transition(task.id, "in_progress", "escalated", "agent-1");
    await engine.transition(task.id, "escalated", "pending", "system");
    await engine.transition(task.id, "pending", "in_progress", "agent-2");
    await engine.transition(task.id, "in_progress", "escalated", "agent-2");

    const final = await store.get(task.id);
    expect(final!.status).toBe("escalated");
  });

  test("blocked -> pending -> in_progress -> blocked cycle", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Block loop",
    });

    await engine.transition(task.id, "pending", "in_progress", "agent-1");
    await engine.transition(task.id, "in_progress", "blocked", "agent-1");
    await engine.transition(task.id, "blocked", "pending", "system");
    await engine.transition(task.id, "pending", "in_progress", "agent-1");
    await engine.transition(task.id, "in_progress", "blocked", "agent-1");

    const final = await store.get(task.id);
    expect(final!.status).toBe("blocked");
  });

  test("cannot transition from completed to any state", async () => {
    const task = await store.create({ tenantId: "t1", description: "Done" });
    await store.update(task.id, { status: "completed" });

    const targets = [
      "pending",
      "in_progress",
      "escalated",
      "blocked",
      "cancelled",
    ] as const;
    for (const to of targets) {
      expect(
        engine.transition(task.id, "completed", to, "agent")
      ).rejects.toThrow(TaskStoreError);
    }
  });

  test("cannot transition from cancelled to any state", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Cancelled",
    });
    await store.update(task.id, { status: "cancelled" });

    const targets = [
      "pending",
      "in_progress",
      "completed",
      "escalated",
      "blocked",
    ] as const;
    for (const to of targets) {
      expect(
        engine.transition(task.id, "cancelled", to, "agent")
      ).rejects.toThrow(TaskStoreError);
    }
  });

  test("validateCreation returns reason string for workers", () => {
    const result = engine.validateCreation(null, "worker");
    expect(result.valid).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  test("validateCreation returns no reason for valid cases", () => {
    const r1 = engine.validateCreation(null, "architect");
    expect(r1.valid).toBe(true);
    expect(r1.reason).toBeUndefined();

    const r2 = engine.validateCreation("parent-id", "worker");
    expect(r2.valid).toBe(true);
    expect(r2.reason).toBeUndefined();
  });
});

describe("Lock edge cases", () => {
  test("attemptClaim on task with owner set but not in_progress returns null", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    // Manually set owner without changing status (shouldn't happen normally)
    await store.update(task.id, { owner: "stale-agent" });

    const result = await lock.attemptClaim(task.id, "agent-1");
    expect(result).toBeNull();
  });

  test("multiple release attempts by same owner after first release fails", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await lock.attemptClaim(task.id, "agent-1");
    await lock.releaseClaim(task.id, "agent-1");

    // Second release fails because owner is now NULL
    expect(lock.releaseClaim(task.id, "agent-1")).rejects.toThrow(
      TaskStoreError
    );
  });

  test("claim preserves all task fields", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Preserve fields",
      llmCallsBudget: 50,
      maxAttempts: 7,
    });

    const claimed = await lock.attemptClaim(task.id, "agent-1");
    expect(claimed!.tenantId).toBe("t1");
    expect(claimed!.description).toBe("Preserve fields");
    expect(claimed!.llmCallsBudget).toBe(50);
    expect(claimed!.maxAttempts).toBe(7);
    expect(claimed!.llmCallsUsed).toBe(0);
    expect(claimed!.attemptCount).toBe(0);
    expect(claimed!.output).toBeNull();
    expect(claimed!.parentId).toBeNull();
  });

  test("release preserves task fields except status and owner", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Release test",
      llmCallsBudget: 42,
    });
    await lock.attemptClaim(task.id, "agent-1");
    await store.update(task.id, { output: "partial work" });

    const released = await lock.releaseClaim(task.id, "agent-1");
    expect(released.status).toBe("pending");
    expect(released.owner).toBeNull();
    expect(released.description).toBe("Release test");
    expect(released.llmCallsBudget).toBe(42);
    // Output is preserved on release
    expect(released.output).toBe("partial work");
  });
});

describe("Budget edge cases", () => {
  test("budget of 1 — single call exhausts", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Tight budget",
      llmCallsBudget: 1,
    });
    await store.update(task.id, { status: "in_progress" });

    const before = await engine.checkBudget(task.id);
    expect(before.allowed).toBe(true);
    expect(before.remaining).toBe(1);

    await store.incrementLlmCalls(task.id);
    const after = await engine.checkBudget(task.id);
    expect(after.allowed).toBe(false);
    expect(after.autoEscalated).toBe(true);
  });

  test("checkBudget result has correct used/budget/remaining values", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Check values",
      llmCallsBudget: 10,
    });
    await store.update(task.id, { status: "in_progress" });

    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);

    const result = await engine.checkBudget(task.id);
    expect(result.used).toBe(3);
    expect(result.budget).toBe(10);
    expect(result.remaining).toBe(7);
    expect(result.allowed).toBe(true);
  });

  test("auto-escalation only happens once", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Escalate once",
      llmCallsBudget: 1,
    });
    await store.update(task.id, { status: "in_progress" });
    await store.incrementLlmCalls(task.id);

    const first = await engine.checkBudget(task.id);
    expect(first.autoEscalated).toBe(true);

    // Second call — task is now escalated, not in_progress
    const second = await engine.checkBudget(task.id);
    expect(second.autoEscalated).toBe(false);
    expect(second.allowed).toBe(false);
  });
});
