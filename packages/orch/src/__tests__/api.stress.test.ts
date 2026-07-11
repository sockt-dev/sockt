import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore, FsmEngine, TaskClaimLock, createTestDb } from "@sockt/fsm";
import { OrchestratorApi } from "../api/server.ts";
import { LockManager } from "../lock/lock-manager.ts";
import type { Database } from "bun:sqlite";
import type { TelemetryEmitter } from "@sockt/types";

describe("OrchestratorApi — stress & edge cases", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let fsm: FsmEngine;
  let claimLock: TaskClaimLock;
  let lockManager: LockManager;
  let api: OrchestratorApi;
  let telemetryEvents: unknown[];

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteTaskStore(db);
    fsm = new FsmEngine(store);
    claimLock = new TaskClaimLock(db);
    lockManager = new LockManager();
    telemetryEvents = [];
    const telemetry: TelemetryEmitter = {
      emit: (event) => { telemetryEvents.push(event); },
      flush: async () => {},
    };
    api = new OrchestratorApi({ store, fsm, claimLock, lockManager, db, telemetry });
  });

  function request(path: string, init?: RequestInit) {
    return api.getApp().request(path, init);
  }

  function json(body: unknown): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  // ── Concurrent claim stress ─────────────────────────────────

  test("100 concurrent claims on same task: exactly 1 wins", async () => {
    const task = await store.create({ tenantId: "t1", description: "Race task" });

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        request("/tasks/claim", json({ taskId: task.id, agentId: `agent-${i}` }))
      )
    );

    const successes = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(99);
  });

  test("50 tasks created and claimed in sequence", async () => {
    const tasks = [];
    for (let i = 0; i < 50; i++) {
      const task = await store.create({ tenantId: "t1", description: `Task ${i}` });
      tasks.push(task);
    }

    for (let i = 0; i < 50; i++) {
      const res = await request("/tasks/claim", json({ taskId: tasks[i].id, agentId: `agent-${i}` }));
      expect(res.status).toBe(200);
    }

    const pendingRes = await request("/tasks/pending?tenantId=t1");
    const pending = await pendingRes.json();
    expect(pending).toHaveLength(0);
  });

  // ── Budget exhaustion edge cases ────────────────────────────

  test("llm-call on budget=1 task: first call exhausts and escalates", async () => {
    const task = await store.create({ tenantId: "t1", description: "Budget 1", llmCallsBudget: 1 });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

    const res = await request(`/tasks/${task.id}/llm-call`, json({}));
    const body = await res.json();
    expect(body.remaining).toBe(0);

    const updated = await store.get(task.id);
    expect(updated?.status).toBe("escalated");
  });

  test("llm-call after task already escalated does not throw", async () => {
    const task = await store.create({ tenantId: "t1", description: "Already esc", llmCallsBudget: 1 });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
    await request(`/tasks/${task.id}/llm-call`, json({}));

    // Task is now escalated, another llm-call should not crash
    const res = await request(`/tasks/${task.id}/llm-call`, json({}));
    expect(res.status).toBe(200);
  });

  test("rapid llm-calls decrement correctly", async () => {
    const task = await store.create({ tenantId: "t1", description: "Rapid calls", llmCallsBudget: 10 });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

    const results = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(`/tasks/${task.id}/llm-call`, json({}));
      results.push(await res.json());
    }

    expect(results[0].remaining).toBe(9);
    expect(results[9].remaining).toBe(0);
  });

  // ── Complete/escalate edge cases ────────────────────────────

  test("complete with empty string output succeeds", async () => {
    const task = await store.create({ tenantId: "t1", description: "Empty output" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

    const res = await request(`/tasks/${task.id}/complete`, json({ output: "", agentId: "agent-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output).toBe("");
  });

  test("complete with very long output", async () => {
    const task = await store.create({ tenantId: "t1", description: "Long output" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

    const longOutput = "x".repeat(100000);
    const res = await request(`/tasks/${task.id}/complete`, json({ output: longOutput, agentId: "agent-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output).toBe(longOutput);
  });

  test("complete already completed task returns 400", async () => {
    const task = await store.create({ tenantId: "t1", description: "Double complete" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
    await request(`/tasks/${task.id}/complete`, json({ output: "first", agentId: "agent-1" }));

    const res = await request(`/tasks/${task.id}/complete`, json({ output: "second", agentId: "agent-1" }));
    expect(res.status).toBe(400);
  });

  test("escalate already escalated task returns 400", async () => {
    const task = await store.create({ tenantId: "t1", description: "Double escalate" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
    await request(`/tasks/${task.id}/escalate`, json({ reason: "first", agentId: "agent-1" }));

    const res = await request(`/tasks/${task.id}/escalate`, json({ reason: "second", agentId: "agent-1" }));
    expect(res.status).toBe(400);
  });

  test("complete non-existent task returns 400", async () => {
    const res = await request("/tasks/nonexistent/complete", json({ output: "test", agentId: "a" }));
    expect(res.status).toBe(400);
  });

  // ── Task creation validation ────────────────────────────────

  test("create task with all optional fields", async () => {
    const task = await store.create({ tenantId: "t1", description: "Parent" });
    const res = await request("/tasks", json({
      tenantId: "t1",
      description: "Full task",
      parentId: task.id,
      role: "worker",
      llmCallsBudget: 50,
      maxAttempts: 5,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.llmCallsBudget).toBe(50);
    expect(body.maxAttempts).toBe(5);
    expect(body.parentId).toBe(task.id);
  });

  test("architect can create top-level task", async () => {
    const res = await request("/tasks", json({
      tenantId: "t1",
      description: "Top level",
      role: "architect",
    }));
    expect(res.status).toBe(201);
  });

  test("worker can create subtask with parent", async () => {
    const parent = await store.create({ tenantId: "t1", description: "Parent" });
    const res = await request("/tasks", json({
      tenantId: "t1",
      description: "Subtask",
      parentId: parent.id,
      role: "worker",
    }));
    expect(res.status).toBe(201);
  });

  // ── Approval edge cases ─────────────────────────────────────

  test("decide on non-existent approval returns 404", async () => {
    const res = await request("/approvals/nonexistent/decide", json({ status: "approved" }));
    expect(res.status).toBe(404);
  });

  test("get non-existent approval returns 404", async () => {
    const res = await request("/approvals/nonexistent");
    expect(res.status).toBe(404);
  });

  test("decide with denied status", async () => {
    const createRes = await request("/approvals", json({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-1",
      tier: "confirm",
      action: "delete-data",
      description: "Delete user data",
    }));
    const { id } = await createRes.json();

    const res = await request(`/approvals/${id}/decide`, json({
      status: "denied",
      decidedBy: "admin",
      reason: "Too risky",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("denied");
    expect(body.reason).toBe("Too risky");
  });

  test("multiple approvals created independently", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request("/approvals", json({
        tenantId: "t1",
        agentId: `agent-${i}`,
        taskId: `task-${i}`,
        tier: "confirm",
        action: `action-${i}`,
        description: `Approval ${i}`,
      }));
      const body = await res.json();
      ids.push(body.id);
    }

    for (const id of ids) {
      const res = await request(`/approvals/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("pending");
    }
  });

  // ── Telemetry emission ──────────────────────────────────────

  test("telemetry emits on claim, complete, escalate, create", async () => {
    const t1 = await store.create({ tenantId: "t1", description: "Telemetry task 1" });
    const t2 = await store.create({ tenantId: "t1", description: "Telemetry task 2" });

    await request("/tasks/claim", json({ taskId: t1.id, agentId: "a1" }));
    await request("/tasks/claim", json({ taskId: t2.id, agentId: "a2" }));
    await request(`/tasks/${t1.id}/complete`, json({ output: "done", agentId: "a1" }));
    await request(`/tasks/${t2.id}/escalate`, json({ reason: "stuck", agentId: "a2" }));
    await request("/tasks", json({ tenantId: "t1", description: "New", role: "architect" }));

    const types = telemetryEvents.map((e: any) => e.type);
    expect(types).toContain("task_claimed");
    expect(types).toContain("task_completed");
    expect(types).toContain("task_escalated");
    expect(types).toContain("task_created");
  });

  // ── Multi-tenant isolation ──────────────────────────────────

  test("pending tasks are isolated by tenant", async () => {
    for (let i = 0; i < 5; i++) {
      await store.create({ tenantId: "t1", description: `T1 task ${i}` });
    }
    for (let i = 0; i < 3; i++) {
      await store.create({ tenantId: "t2", description: `T2 task ${i}` });
    }

    const res1 = await request("/tasks/pending?tenantId=t1");
    const res2 = await request("/tasks/pending?tenantId=t2");
    const res3 = await request("/tasks/pending?tenantId=t3");

    expect((await res1.json())).toHaveLength(5);
    expect((await res2.json())).toHaveLength(3);
    expect((await res3.json())).toHaveLength(0);
  });

  // ── Lock manager integration ────────────────────────────────

  test("claim acquires lock, complete releases it", async () => {
    const task = await store.create({ tenantId: "t1", description: "Lock test" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
    expect(lockManager.isAtCapacity("agent-1", 1)).toBe(true);

    await request(`/tasks/${task.id}/complete`, json({ output: "done", agentId: "agent-1" }));
    expect(lockManager.isAtCapacity("agent-1", 1)).toBe(false);
  });

  test("escalate also releases the lock", async () => {
    const task = await store.create({ tenantId: "t1", description: "Lock esc test" });
    await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
    expect(lockManager.isAtCapacity("agent-1", 1)).toBe(true);

    await request(`/tasks/${task.id}/escalate`, json({ reason: "help", agentId: "agent-1" }));
    expect(lockManager.isAtCapacity("agent-1", 1)).toBe(false);
  });
});
