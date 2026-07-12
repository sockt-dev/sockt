import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore, FsmEngine, TaskClaimLock, createTestDb } from "@sockt/fsm";
import { OrchestratorApi } from "../api/server.ts";
import { LockManager } from "../lock/lock-manager.ts";
import type { Database } from "bun:sqlite";

describe("OrchestratorApi", () => {
  let db: Database;
  let store: SqliteTaskStore;
  let fsm: FsmEngine;
  let claimLock: TaskClaimLock;
  let lockManager: LockManager;
  let api: OrchestratorApi;

  beforeEach(() => {
    db = createTestDb();
    store = new SqliteTaskStore(db);
    fsm = new FsmEngine(store);
    claimLock = new TaskClaimLock(db);
    lockManager = new LockManager();
    api = new OrchestratorApi({ store, fsm, claimLock, lockManager, db });
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

  async function createPendingTask(tenantId = "t1", description = "Test task") {
    return store.create({ tenantId, description });
  }

  // ── Task Claim ──────────────────────────────────────────────

  describe("POST /tasks/claim", () => {
    test("returns 200 with claimed task", async () => {
      const task = await createPendingTask();
      const res = await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("in_progress");
      expect(body.owner).toBe("agent-1");
    });

    test("returns 409 on double-claim", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
      const res = await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-2" }));
      expect(res.status).toBe(409);
    });

    test("returns 409 for non-existent task", async () => {
      const res = await request("/tasks/claim", json({ taskId: "nonexistent", agentId: "agent-1" }));
      expect(res.status).toBe(409);
    });
  });

  // ── Task Complete ───────────────────────────────────────────

  describe("POST /tasks/:id/complete", () => {
    test("transitions to completed and stores output", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/complete`, json({ output: "Done!", agentId: "agent-1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("completed");
      expect(body.output).toBe("Done!");
    });

    test("returns 400 if task not in_progress", async () => {
      const task = await createPendingTask();
      const res = await request(`/tasks/${task.id}/complete`, json({ output: "Done!", agentId: "agent-1" }));
      expect(res.status).toBe(400);
    });
  });

  // ── Task Escalate ───────────────────────────────────────────

  describe("POST /tasks/:id/escalate", () => {
    test("transitions to escalated and stores reason", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/escalate`, json({ reason: "Too complex", agentId: "agent-1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("escalated");
    });

    test("returns 400 if task not in_progress", async () => {
      const task = await createPendingTask();
      const res = await request(`/tasks/${task.id}/escalate`, json({ reason: "Help", agentId: "agent-1" }));
      expect(res.status).toBe(400);
    });
  });

  // ── Task Block (HITL) ──────────────────────────────────────

  describe("POST /tasks/:id/block", () => {
    test("transitions to blocked and stores dependency", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/block`, json({ dependency: "HITL denied: exec_code", agentId: "agent-1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("blocked");
    });

    test("returns 400 if task not in_progress", async () => {
      const task = await createPendingTask();
      const res = await request(`/tasks/${task.id}/block`, json({ dependency: "waiting", agentId: "agent-1" }));
      expect(res.status).toBe(400);
    });

    test("blocked task can be retried and re-claimed by a different agent", async () => {
      // Regression test: /retry previously left `owner` set to the original
      // claiming agent, and claimStmt requires `status='pending' AND owner IS
      // NULL` — so a blocked-then-retried task could never actually be
      // re-claimed by anyone. This path was untested before HITL made
      // `blocked` reachable.
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
      await request(`/tasks/${task.id}/block`, json({ dependency: "HITL denied", agentId: "agent-1" }));

      const retryRes = await request(`/tasks/${task.id}/retry`, { method: "POST" });
      expect(retryRes.status).toBe(200);
      const retried = await retryRes.json();
      expect(retried.status).toBe("pending");
      expect(retried.owner).toBeNull();

      const reclaimRes = await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-2" }));
      expect(reclaimRes.status).toBe(200);
      const reclaimed = await reclaimRes.json();
      expect(reclaimed.owner).toBe("agent-2");
    });
  });

  // ── Task Request Input (clarifying question) ────────────────

  describe("POST /tasks/:id/request-input", () => {
    test("transitions to blocked and clears owner", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/request-input`, json({ question: "Which environment?", agentId: "agent-1" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("blocked");
    });

    test("returns 400 if task not in_progress", async () => {
      const task = await createPendingTask();
      const res = await request(`/tasks/${task.id}/request-input`, json({ question: "Which environment?", agentId: "agent-1" }));
      expect(res.status).toBe(400);
    });

    test("a blocked task awaiting input can be retried and re-claimed", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));
      await request(`/tasks/${task.id}/request-input`, json({ question: "Which environment?", agentId: "agent-1" }));

      const retryRes = await request(`/tasks/${task.id}/retry`, { method: "POST" });
      expect(retryRes.status).toBe(200);
      const retried = await retryRes.json();
      expect(retried.owner).toBeNull();

      const reclaimRes = await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-2" }));
      expect(reclaimRes.status).toBe(200);
    });
  });

  // ── LLM Call ────────────────────────────────────────────────

  describe("POST /tasks/:id/llm-call", () => {
    test("increments counter and returns remaining", async () => {
      const task = await createPendingTask();
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/llm-call`, json({}));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.remaining).toBe(24); // default budget is 25, used 1
    });

    test("auto-escalates when budget exhausted", async () => {
      const task = await store.create({ tenantId: "t1", description: "Budget test", llmCallsBudget: 1 });
      await request("/tasks/claim", json({ taskId: task.id, agentId: "agent-1" }));

      const res = await request(`/tasks/${task.id}/llm-call`, json({}));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.remaining).toBe(0);

      const updated = await store.get(task.id);
      expect(updated?.status).toBe("escalated");
    });
  });

  // ── List Pending ────────────────────────────────────────────

  describe("GET /tasks/pending", () => {
    test("returns pending tasks for tenant", async () => {
      await createPendingTask("t1", "Task 1");
      await createPendingTask("t1", "Task 2");
      await createPendingTask("t2", "Task 3");

      const res = await request("/tasks/pending?tenantId=t1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    test("returns 400 if tenantId missing", async () => {
      const res = await request("/tasks/pending");
      expect(res.status).toBe(400);
    });
  });

  // ── Create Task ─────────────────────────────────────────────

  describe("POST /tasks", () => {
    test("creates task and returns 201", async () => {
      const res = await request("/tasks", json({
        tenantId: "t1",
        description: "New task",
        role: "architect",
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.description).toBe("New task");
      expect(body.status).toBe("pending");
    });

    test("returns 403 when worker creates top-level task", async () => {
      const res = await request("/tasks", json({
        tenantId: "t1",
        description: "Worker task",
        role: "worker",
      }));
      expect(res.status).toBe(403);
    });

    test("worker can create subtask", async () => {
      const parent = await createPendingTask();
      const res = await request("/tasks", json({
        tenantId: "t1",
        description: "Subtask",
        parentId: parent.id,
        role: "worker",
      }));
      expect(res.status).toBe(201);
    });

    test("targetDepartment/targetRole/targetSkill/afterId are persisted, not dropped", async () => {
      const dep = await createPendingTask();
      const res = await request("/tasks", json({
        tenantId: "t1",
        description: "Write outreach copy",
        parentId: dep.id,
        role: "worker",
        targetDepartment: "growth",
        targetRole: "worker",
        targetSkill: "outreach-copy",
        afterId: dep.id,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.targetDepartment).toBe("growth");
      expect(body.targetRole).toBe("worker");
      expect(body.targetSkill).toBe("outreach-copy");
      expect(body.afterId).toBe(dep.id);
    });

    test("a task ordered after a pending dependency is excluded from /tasks/pending until it completes", async () => {
      const dep = await createPendingTask("t1", "Generate leads");
      await request("/tasks", json({
        tenantId: "t1",
        description: "Write outreach copy",
        role: "architect",
        afterId: dep.id,
      }));

      let pendingRes = await request("/tasks/pending?tenantId=t1");
      let pending = await pendingRes.json();
      expect(pending.map((t: { description: string }) => t.description)).toEqual(["Generate leads"]);

      await request("/tasks/claim", json({ taskId: dep.id, agentId: "agent-1" }));
      await request(`/tasks/${dep.id}/complete`, json({ output: "10 leads", agentId: "agent-1" }));

      pendingRes = await request("/tasks/pending?tenantId=t1");
      pending = await pendingRes.json();
      expect(pending.map((t: { description: string }) => t.description)).toEqual(["Write outreach copy"]);
    });
  });

  // ── Approvals ───────────────────────────────────────────────

  describe("Approval routes", () => {
    test("POST /approvals creates approval and returns 201", async () => {
      const res = await request("/approvals", json({
        tenantId: "t1",
        agentId: "agent-1",
        taskId: "task-1",
        tier: "confirm",
        action: "send-email",
        description: "Send marketing email to 1000 users",
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("pending");
    });

    test("GET /approvals/:id returns approval status", async () => {
      const createRes = await request("/approvals", json({
        tenantId: "t1",
        agentId: "agent-1",
        taskId: "task-1",
        tier: "confirm",
        action: "deploy",
        description: "Deploy to production",
      }));
      const { id } = await createRes.json();

      const res = await request(`/approvals/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("pending");
    });

    test("POST /approvals/:id/decide updates status", async () => {
      const createRes = await request("/approvals", json({
        tenantId: "t1",
        agentId: "agent-1",
        taskId: "task-1",
        tier: "confirm",
        action: "deploy",
        description: "Deploy to production",
      }));
      const { id } = await createRes.json();

      const res = await request(`/approvals/${id}/decide`, json({
        status: "approved",
        decidedBy: "operator-1",
        reason: "Looks good",
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("approved");
      expect(body.decidedBy).toBe("operator-1");
    });
  });

  // ── Health ──────────────────────────────────────────────────

  describe("GET /health", () => {
    test("returns 200 with status fields", async () => {
      const res = await request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("healthy");
      expect(typeof body.uptime).toBe("number");
      expect(typeof body.pendingTasks).toBe("number");
    });
  });

  // ── Error Handling ──────────────────────────────────────────

  describe("Error handling", () => {
    test("unknown route returns 404", async () => {
      const res = await request("/unknown");
      expect(res.status).toBe(404);
    });
  });
});

describe("OrchestratorApi with apiToken set", () => {
  let db: Database;
  let authedApi: OrchestratorApi;

  beforeEach(() => {
    db = createTestDb();
    const store = new SqliteTaskStore(db);
    const fsm = new FsmEngine(store);
    const claimLock = new TaskClaimLock(db);
    const lockManager = new LockManager();
    authedApi = new OrchestratorApi({ store, fsm, claimLock, lockManager, db, apiToken: "s3cr3t" });
  });

  function authedRequest(path: string, init?: RequestInit) {
    return authedApi.getApp().request(path, init);
  }

  test("rejects requests with no Authorization header", async () => {
    const res = await authedRequest("/tasks/pending?tenantId=t1");
    expect(res.status).toBe(401);
  });

  test("rejects requests with the wrong token", async () => {
    const res = await authedRequest("/tasks/pending?tenantId=t1", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("accepts requests with the correct token", async () => {
    const res = await authedRequest("/tasks/pending?tenantId=t1", {
      headers: { Authorization: "Bearer s3cr3t" },
    });
    expect(res.status).toBe(200);
  });

  test("/health stays open even without a token", async () => {
    const res = await authedRequest("/health");
    expect(res.status).toBe(200);
  });
});
