import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { FsmEngine } from "../fsm/engine.ts";
import { TaskClaimLock } from "../lock/task-claim-lock.ts";
import { createTestDb } from "../util/test-db.ts";
import { TRANSITIONS } from "../fsm/transitions.ts";
import { TASK_STATUS_VALUES } from "@sockt/types";
import type { TaskStatus, Task } from "@sockt/types";
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

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function getValidTargets(status: TaskStatus): TaskStatus[] {
  return TRANSITIONS[status];
}

describe("Property-based: random transition sequences", () => {
  test("random walks always end at terminal or valid non-terminal", async () => {
    for (let trial = 0; trial < 50; trial++) {
      const task = await store.create({
        tenantId: "t1",
        description: `Random walk ${trial}`,
      });

      let current: TaskStatus = "pending";
      const maxSteps = 20;

      for (let step = 0; step < maxSteps; step++) {
        const targets = getValidTargets(current);
        if (targets.length === 0) break;

        const next = randomChoice(targets);
        await engine.transition(task.id, current, next, "agent");
        current = next;
      }

      const finalTask = await store.get(task.id);
      expect(finalTask!.status).toBe(current);
      expect(TASK_STATUS_VALUES).toContain(current);
    }
  });

  test("random walks with budget tracking never go negative remaining via checkBudget", async () => {
    for (let trial = 0; trial < 20; trial++) {
      const budget = Math.floor(Math.random() * 10) + 1;
      const task = await store.create({
        tenantId: "t1",
        description: `Budget trial ${trial}`,
        llmCallsBudget: budget,
      });
      await engine.transition(task.id, "pending", "in_progress", "agent");

      for (let i = 0; i < budget + 5; i++) {
        const currentTask = await store.get(task.id);
        if (
          currentTask!.status !== "in_progress" &&
          currentTask!.status !== "pending"
        ) {
          break;
        }
        await store.incrementLlmCalls(task.id);
        const check = await engine.checkBudget(task.id);
        // remaining in the result should never report negative
        expect(check.remaining).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("claiming and releasing never corrupts task state", async () => {
    for (let trial = 0; trial < 30; trial++) {
      const task = await store.create({
        tenantId: "t1",
        description: `Claim trial ${trial}`,
      });

      const agent = `agent-${trial}`;
      const claimed = await lock.attemptClaim(task.id, agent);
      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("in_progress");
      expect(claimed!.owner).toBe(agent);

      const released = await lock.releaseClaim(task.id, agent);
      expect(released.status).toBe("pending");
      expect(released.owner).toBeNull();

      // Should be claimable again
      const reclaimed = await lock.attemptClaim(task.id, `new-${agent}`);
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.owner).toBe(`new-${agent}`);
    }
  });

  test("countByStatus always sums to total task count", async () => {
    const numTasks = 20;
    const tasks: Task[] = [];

    for (let i = 0; i < numTasks; i++) {
      tasks.push(
        await store.create({ tenantId: "t1", description: `Task ${i}` })
      );
    }

    // Randomly transition some tasks
    const statuses: TaskStatus[] = [
      "in_progress",
      "completed",
      "escalated",
      "blocked",
      "cancelled",
    ];
    for (let i = 0; i < 10; i++) {
      const task = randomChoice(tasks);
      const current = (await store.get(task.id))!.status;
      const targets = getValidTargets(current);
      if (targets.length > 0) {
        const next = randomChoice(targets);
        await engine.transition(task.id, current, next, "agent");
      }
    }

    const counts = await store.countByStatus("t1");
    const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
    expect(total).toBe(numTasks);
  });

  test("all status values in TRANSITIONS map are valid TaskStatus values", () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      expect(TASK_STATUS_VALUES).toContain(from as TaskStatus);
      for (const to of targets) {
        expect(TASK_STATUS_VALUES).toContain(to);
      }
    }
  });

  test("TRANSITIONS covers all TaskStatus values", () => {
    const keys = Object.keys(TRANSITIONS) as TaskStatus[];
    for (const status of TASK_STATUS_VALUES) {
      expect(keys).toContain(status);
    }
  });

  test("no transition target includes the source state (no self-loops)", () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      expect(targets).not.toContain(from as TaskStatus);
    }
  });

  test("terminal states have empty target arrays", () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });

  test("non-terminal states have at least one target", () => {
    const nonTerminal: TaskStatus[] = [
      "pending",
      "in_progress",
      "escalated",
      "blocked",
    ];
    for (const status of nonTerminal) {
      expect(TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("Property-based: data integrity", () => {
  test("create -> get roundtrip preserves all fields", async () => {
    for (let trial = 0; trial < 20; trial++) {
      const input = {
        tenantId: `tenant-${trial}`,
        description: `Description ${trial} with special chars: <>&"'`,
        llmCallsBudget: 10 + trial,
        maxAttempts: 1 + (trial % 5),
      };

      const created = await store.create(input);
      const fetched = await store.get(created.id);

      expect(fetched).toEqual(created);
      expect(fetched!.tenantId).toBe(input.tenantId);
      expect(fetched!.description).toBe(input.description);
      expect(fetched!.llmCallsBudget).toBe(input.llmCallsBudget);
      expect(fetched!.maxAttempts).toBe(input.maxAttempts);
    }
  });

  test("updatedAt strictly increases with each update", async () => {
    const task = await store.create({ tenantId: "t1", description: "Track time" });
    let lastUpdated = task.updatedAt;

    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await store.update(task.id, { attemptCount: i + 1 });
      const fetched = await store.get(task.id);
      expect(fetched!.updatedAt > lastUpdated).toBe(true);
      lastUpdated = fetched!.updatedAt;
    }
  });

  test("createdAt never changes regardless of updates", async () => {
    const task = await store.create({ tenantId: "t1", description: "Immutable createdAt" });
    const originalCreatedAt = task.createdAt;

    await store.update(task.id, { status: "in_progress" });
    await store.update(task.id, { owner: "agent-1" });
    await store.update(task.id, { output: "result" });
    await store.update(task.id, { attemptCount: 2 });

    const fetched = await store.get(task.id);
    expect(fetched!.createdAt).toBe(originalCreatedAt);
  });

  test("high-volume creation doesn't produce duplicate ids", async () => {
    const ids = new Set<string>();
    const count = 500;

    for (let i = 0; i < count; i++) {
      const task = await store.create({ tenantId: "t1", description: `Task ${i}` });
      ids.add(task.id);
    }

    expect(ids.size).toBe(count);
  });

  test("listPending only returns pending status (never leaks other statuses)", async () => {
    for (let i = 0; i < 10; i++) {
      const task = await store.create({ tenantId: "t1", description: `Task ${i}` });
      if (i % 2 === 0) {
        await store.update(task.id, { status: "in_progress" });
      }
      if (i % 3 === 0 && i > 0) {
        await store.update(task.id, { status: "cancelled" });
      }
    }

    const pending = await store.listPending("t1");
    for (const task of pending) {
      expect(task.status).toBe("pending");
    }
  });
});

describe("Property-based: concurrent operations", () => {
  test("100 claim attempts on same task - exactly one winner", async () => {
    const task = await store.create({ tenantId: "t1", description: "Hot task" });

    const agents = Array.from({ length: 100 }, (_, i) => `agent-${i}`);
    const results = await Promise.all(
      agents.map((agent) => lock.attemptClaim(task.id, agent))
    );

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);

    const finalTask = await store.get(task.id);
    expect(finalTask!.status).toBe("in_progress");
    expect(finalTask!.owner).toBe(winners[0]!.owner);
  });

  test("parallel creates don't interfere", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        store.create({ tenantId: "t1", description: `Parallel ${i}` })
      )
    );

    expect(results).toHaveLength(50);
    const ids = new Set(results.map((t) => t.id));
    expect(ids.size).toBe(50);

    const pending = await store.listPending("t1");
    expect(pending).toHaveLength(50);
  });

  test("parallel incrementLlmCalls on same task are all counted", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Counter",
      llmCallsBudget: 100,
    });

    const numIncrements = 50;
    await Promise.all(
      Array.from({ length: numIncrements }, () =>
        store.incrementLlmCalls(task.id)
      )
    );

    const fetched = await store.get(task.id);
    expect(fetched!.llmCallsUsed).toBe(numIncrements);
  });
});
