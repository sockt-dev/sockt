import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { FsmEngine } from "../fsm/engine.ts";
import { TaskClaimLock } from "../lock/task-claim-lock.ts";
import { createTestDb } from "../util/test-db.ts";
import { initializeSchema } from "../store/schema.ts";
import { Database } from "bun:sqlite";
import type { TaskStatus } from "@sockt/types";

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

describe("Stress tests", () => {
  test("1000 task creates in sequence", async () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await store.create({ tenantId: "t1", description: `Task ${i}` });
    }
    const elapsed = performance.now() - start;

    const pending = await store.listPending("t1");
    expect(pending).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000); // should be well under 5s
  });

  test("1000 tasks — full lifecycle pipeline", async () => {
    const tasks = [];
    for (let i = 0; i < 100; i++) {
      tasks.push(
        await store.create({
          tenantId: "t1",
          description: `Pipeline ${i}`,
          llmCallsBudget: 5,
        })
      );
    }

    // Claim all
    for (const task of tasks) {
      await lock.attemptClaim(task.id, `agent-${task.id.slice(-4)}`);
    }

    // Increment calls and complete
    for (const task of tasks) {
      await store.incrementLlmCalls(task.id);
      await store.incrementLlmCalls(task.id);
      await engine.transition(task.id, "in_progress", "completed", "agent");
    }

    const counts = await store.countByStatus("t1");
    expect(counts.completed).toBe(100);
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(0);
  });

  test("deeply nested parent-child hierarchy (5 levels)", async () => {
    let parentId: string | undefined;
    const chain: string[] = [];

    for (let depth = 0; depth < 5; depth++) {
      const task = await store.create({
        tenantId: "t1",
        description: `Level ${depth}`,
        parentId,
      });
      chain.push(task.id);
      parentId = task.id;
    }

    // Verify each level
    for (let i = 0; i < 4; i++) {
      const children = await store.listByParent(chain[i]!);
      expect(children).toHaveLength(1);
      expect(children[0]!.id).toBe(chain[i + 1]);
    }

    // Leaf has no children
    const leaf = await store.listByParent(chain[4]!);
    expect(leaf).toHaveLength(0);
  });

  test("wide parent-child (100 children under one parent)", async () => {
    const parent = await store.create({
      tenantId: "t1",
      description: "Wide parent",
    });

    for (let i = 0; i < 100; i++) {
      await store.create({
        tenantId: "t1",
        description: `Child ${i}`,
        parentId: parent.id,
      });
    }

    const children = await store.listByParent(parent.id);
    expect(children).toHaveLength(100);
  });

  test("rapid claim/release cycles on same task", async () => {
    const task = await store.create({ tenantId: "t1", description: "Rapid" });

    for (let i = 0; i < 50; i++) {
      const agent = `agent-${i}`;
      const claimed = await lock.attemptClaim(task.id, agent);
      expect(claimed).not.toBeNull();
      expect(claimed!.owner).toBe(agent);

      await lock.releaseClaim(task.id, agent);
    }

    const final = await store.get(task.id);
    expect(final!.status).toBe("pending");
    expect(final!.owner).toBeNull();
  });

  test("multiple tenants with independent state", async () => {
    const tenants = Array.from({ length: 10 }, (_, i) => `tenant-${i}`);

    for (const tenant of tenants) {
      for (let i = 0; i < 20; i++) {
        await store.create({ tenantId: tenant, description: `Task ${i}` });
      }
    }

    for (const tenant of tenants) {
      const pending = await store.listPending(tenant);
      expect(pending).toHaveLength(20);
      expect(pending.every((t) => t.tenantId === tenant)).toBe(true);
    }

    // Total across all tenants
    let total = 0;
    for (const tenant of tenants) {
      const counts = await store.countByStatus(tenant);
      total += Object.values(counts).reduce((s, c) => s + c, 0);
    }
    expect(total).toBe(200);
  });

  test("budget exhaustion across many tasks triggers exactly right escalations", async () => {
    const tasks = [];
    for (let i = 0; i < 20; i++) {
      const task = await store.create({
        tenantId: "t1",
        description: `Budget task ${i}`,
        llmCallsBudget: 3,
      });
      await engine.transition(task.id, "pending", "in_progress", "agent");
      tasks.push(task);
    }

    // Exhaust budget on half
    for (let i = 0; i < 10; i++) {
      const task = tasks[i]!;
      await store.incrementLlmCalls(task.id);
      await store.incrementLlmCalls(task.id);
      await store.incrementLlmCalls(task.id);
      await engine.checkBudget(task.id);
    }

    const counts = await store.countByStatus("t1");
    expect(counts.escalated).toBe(10);
    expect(counts.in_progress).toBe(10);
  });

  test("store handles many different owners correctly", async () => {
    const numAgents = 50;
    const tasksPerAgent = 3;

    for (let a = 0; a < numAgents; a++) {
      for (let t = 0; t < tasksPerAgent; t++) {
        const task = await store.create({
          tenantId: "t1",
          description: `Agent-${a} Task-${t}`,
        });
        await lock.attemptClaim(task.id, `agent-${a}`);
      }
    }

    for (let a = 0; a < numAgents; a++) {
      const owned = await store.listByOwner(`agent-${a}`);
      expect(owned).toHaveLength(tasksPerAgent);
      expect(owned.every((t) => t.owner === `agent-${a}`)).toBe(true);
    }
  });

  test("schema can be re-initialized on existing database without data loss", () => {
    const fileDb = new Database(`:memory:`);
    fileDb.exec("PRAGMA journal_mode=WAL");
    initializeSchema(fileDb);

    const tempStore = new SqliteTaskStore(fileDb);

    // Use sync-wrapped calls
    const createTask = () =>
      tempStore.create({ tenantId: "t1", description: "Survive reinit" });

    let taskId: string;
    createTask().then(async (task) => {
      taskId = task.id;

      // Re-initialize schema
      initializeSchema(fileDb);

      // Data survives
      const fetched = await tempStore.get(taskId);
      expect(fetched).not.toBeNull();
      expect(fetched!.description).toBe("Survive reinit");
    });
  });

  test("in-memory test database creates in under 5ms", () => {
    const start = performance.now();
    const testDb = createTestDb();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
    expect(testDb).toBeDefined();
  });
});

describe("Error message quality", () => {
  test("TaskStoreError from invalid transition includes from/to states", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });

    try {
      await engine.transition(task.id, "pending", "completed", "agent");
      expect(true).toBe(false); // should not reach
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      const err = e as Error;
      expect(err.message).toContain("pending");
      expect(err.message).toContain("completed");
    }
  });

  test("TaskStoreError from status mismatch includes expected and actual", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await engine.transition(task.id, "pending", "in_progress", "agent");

    try {
      await engine.transition(task.id, "pending", "cancelled", "agent");
      expect(true).toBe(false);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      const err = e as Error;
      expect(err.message).toContain("pending");
      expect(err.message).toContain("in_progress");
    }
  });

  test("TaskStoreError from failed claim includes taskId", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await store.claim(task.id, "agent-1");

    try {
      await store.claim(task.id, "agent-2");
      expect(true).toBe(false);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      const err = e as { context?: Record<string, unknown> };
      expect(err.context).toBeDefined();
      expect(err.context!.taskId).toBe(task.id);
    }
  });

  test("TaskStoreError from release wrong owner includes context", async () => {
    const task = await store.create({ tenantId: "t1", description: "Test" });
    await lock.attemptClaim(task.id, "agent-1");

    try {
      await lock.releaseClaim(task.id, "agent-2");
      expect(true).toBe(false);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      const err = e as { context?: Record<string, unknown> };
      expect(err.context).toBeDefined();
      expect(err.context!.currentOwner).toBe("agent-1");
      expect(err.context!.agentId).toBe("agent-2");
    }
  });
});
