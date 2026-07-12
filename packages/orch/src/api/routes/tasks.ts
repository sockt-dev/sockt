import { Hono } from "hono";
import type { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import type { LockManager } from "../../lock/lock-manager.ts";
import type { TelemetryEmitter } from "@sockt/types";
import type { QuestionStore } from "../question-store.ts";
import type { TaskOriginStore } from "../../store/task-origin-store.ts";
import { maybeResumeParent } from "../../join/parent-join.ts";

export interface TaskRouteDeps {
  store: SqliteTaskStore;
  fsm: FsmEngine;
  claimLock: TaskClaimLock;
  lockManager: LockManager;
  telemetry?: TelemetryEmitter;
  questionStore?: QuestionStore;
  taskOriginStore?: TaskOriginStore;
}

export function taskRoutes(deps: TaskRouteDeps): Hono {
  const { store, fsm, claimLock, lockManager, telemetry, questionStore, taskOriginStore } = deps;
  const app = new Hono();

  // Legacy: body contains { taskId, agentId }
  app.post("/tasks/claim", async (c) => {
    const { taskId, agentId } = await c.req.json();
    const task = await claimLock.attemptClaim(taskId, agentId);
    if (!task) return c.json({ error: "Task unavailable" }, 409);
    lockManager.acquire(agentId, taskId);
    telemetry?.emit({ type: "task_claimed", taskId, tenantId: task.tenantId, data: { agentId } });
    return c.json(task);
  });

  // Runtime style: taskId in URL, agentId in body
  app.post("/tasks/:id/claim", async (c) => {
    const taskId = c.req.param("id");
    const { agentId } = await c.req.json();
    const task = await claimLock.attemptClaim(taskId, agentId);
    if (!task) return c.json({ error: "Task unavailable" }, 409);
    lockManager.acquire(agentId, taskId);
    telemetry?.emit({ type: "task_claimed", taskId, tenantId: task.tenantId, data: { agentId } });
    return c.json(task);
  });

  // Runtime alias for llm-call budget tracking
  app.post("/tasks/:id/record-llm-call", async (c) => {
    const taskId = c.req.param("id");
    const result = await store.incrementLlmCalls(taskId);
    if (result.remaining <= 0) {
      const task = await store.get(taskId);
      if (task && task.status === "in_progress") {
        await fsm.transition(taskId, "in_progress", "escalated", "system:budget");
        telemetry?.emit({ type: "task_budget_exhausted", taskId, tenantId: task.tenantId, data: {} });
        await maybeResumeParent(store, fsm, telemetry, taskId);
      }
    }
    return c.json({ allowed: result.remaining > 0, remaining: result.remaining });
  });

  app.post("/tasks/:id/complete", async (c) => {
    const taskId = c.req.param("id");
    const { output, agentId } = await c.req.json();
    try {
      const task = await fsm.transition(taskId, "in_progress", "completed", agentId ?? "unknown");
      await store.update(taskId, { output });
      lockManager.release(agentId ?? "unknown", taskId);
      const updated = await store.get(taskId);
      telemetry?.emit({ type: "task_completed", taskId, tenantId: task.tenantId, data: { output } });
      await maybeResumeParent(store, fsm, telemetry, taskId);
      return c.json(updated);
    } catch {
      return c.json({ error: "Task is not in_progress" }, 400);
    }
  });

  app.post("/tasks/:id/escalate", async (c) => {
    const taskId = c.req.param("id");
    const { reason, agentId } = await c.req.json();
    try {
      const task = await fsm.transition(taskId, "in_progress", "escalated", agentId ?? "unknown");
      await store.update(taskId, { output: reason });
      lockManager.release(agentId ?? "unknown", taskId);
      telemetry?.emit({ type: "task_escalated", taskId, tenantId: task.tenantId, data: { reason } });
      await maybeResumeParent(store, fsm, telemetry, taskId);
      return c.json(task);
    } catch {
      return c.json({ error: "Task is not in_progress" }, 400);
    }
  });

  // Transitions in_progress -> blocked. Not terminal — blocked -> pending is a
  // legal FSM transition, so a human unblocking via /approve (or the future
  // clarifying-question answer path) can send this task back to the pending
  // queue. Added 2026-07-12 for the HITL approval gate: a denied or timed-out
  // approval was returning TaskOutcome{status:"blocked"} from the runner
  // already, but nothing ever transitioned the task or told Slack — it just
  // sat in_progress forever with the claim lock never released.
  app.post("/tasks/:id/block", async (c) => {
    const taskId = c.req.param("id");
    const { dependency, agentId } = await c.req.json();
    try {
      const task = await fsm.transition(taskId, "in_progress", "blocked", agentId ?? "unknown");
      await store.update(taskId, { output: dependency });
      lockManager.release(agentId ?? "unknown", taskId);
      telemetry?.emit({ type: "task_blocked", taskId, tenantId: task.tenantId, data: { dependency } });
      return c.json(task);
    } catch {
      return c.json({ error: "Task is not in_progress" }, 400);
    }
  });

  // Like /block, but also records the clarifying question in QuestionStore
  // (kind='question' in pending_human_inputs) so a later threaded reply can
  // be matched back to it — see Orchestrator.handleMessage's thread-reply
  // interception and QuestionStore.findPendingByThread.
  app.post("/tasks/:id/request-input", async (c) => {
    const taskId = c.req.param("id");
    const { question, agentId } = await c.req.json();
    try {
      const task = await fsm.transition(taskId, "in_progress", "blocked", agentId ?? "unknown");
      await store.update(taskId, { output: `Awaiting human input: ${question}` });
      lockManager.release(agentId ?? "unknown", taskId);

      const origin = taskOriginStore?.get(taskId);
      questionStore?.create({
        tenantId: task.tenantId,
        taskId,
        agentId: agentId ?? "unknown",
        question,
        slackChannelId: origin?.channelId,
        slackThreadId: origin?.threadId ?? undefined,
      });

      telemetry?.emit({ type: "task_needs_input", taskId, tenantId: task.tenantId, data: { question } });
      return c.json(task);
    } catch {
      return c.json({ error: "Task is not in_progress" }, 400);
    }
  });

  app.post("/tasks/:id/llm-call", async (c) => {
    const taskId = c.req.param("id");
    const result = await store.incrementLlmCalls(taskId);
    if (result.remaining <= 0) {
      const task = await store.get(taskId);
      if (task && task.status === "in_progress") {
        await fsm.transition(taskId, "in_progress", "escalated", "system:budget");
        telemetry?.emit({ type: "task_budget_exhausted", taskId, tenantId: task.tenantId, data: {} });
        await maybeResumeParent(store, fsm, telemetry, taskId);
      }
    }
    return c.json(result);
  });

  // Static routes before parameterised — Hono matches in definition order
  app.get("/tasks/pending", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) return c.json({ error: "tenantId query parameter required" }, 400);
    const tasks = await store.listPending(tenantId);
    return c.json(tasks);
  });

  app.get("/tasks", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) return c.json({ error: "tenantId required" }, 400);
    const status = c.req.query("status") as Parameters<typeof store.listAll>[1];
    const tasks = await store.listAll(tenantId, status);
    return c.json(tasks);
  });

  app.get("/tasks/:id", async (c) => {
    const task = await store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  });

  app.patch("/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json();
    const { status, output } = body;
    try {
      const patch: { status?: Parameters<typeof store.update>[1]["status"]; output?: string } = {};
      if (status) patch.status = status;
      if (output !== undefined) patch.output = output;
      const task = await store.update(taskId, patch);
      return c.json(task);
    } catch {
      return c.json({ error: "Task not found" }, 404);
    }
  });

  app.post("/tasks/:id/cancel", async (c) => {
    const taskId = c.req.param("id");
    const task = await store.get(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    try {
      const updated = await store.update(taskId, { status: "cancelled" });
      telemetry?.emit({ type: "task_cancelled", taskId, tenantId: task.tenantId, data: {} });
      await maybeResumeParent(store, fsm, telemetry, taskId);
      return c.json(updated);
    } catch {
      return c.json({ error: "Cannot cancel task" }, 400);
    }
  });

  app.post("/tasks/:id/retry", async (c) => {
    const taskId = c.req.param("id");
    const task = await store.get(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    try {
      // owner must be cleared, not just status: claimStmt only matches
      // `status='pending' AND owner IS NULL`. Without this, a task retried
      // from escalated/blocked keeps its previous owner and can never be
      // re-claimed by anyone — a task that's permanently "pending" but
      // invisible to the claim loop. Found 2026-07-12 while wiring the HITL
      // block()/retry unblock path (previously untested — HITL was never
      // wired up, so blocked was unreachable and retry was never exercised).
      const updated = await store.update(taskId, { status: "pending", owner: null });
      telemetry?.emit({ type: "task_retried", taskId, tenantId: task.tenantId, data: {} });
      return c.json(updated);
    } catch {
      return c.json({ error: "Cannot retry task" }, 400);
    }
  });

  app.post("/tasks/:id/approve", async (c) => {
    const taskId = c.req.param("id");
    const task = await store.get(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    try {
      // See /retry — same owner-clearing requirement.
      const updated = await store.update(taskId, { status: "pending", owner: null });
      telemetry?.emit({ type: "task_approved", taskId, tenantId: task.tenantId, data: {} });
      return c.json(updated);
    } catch {
      return c.json({ error: "Cannot approve task" }, 400);
    }
  });

  app.post("/tasks/:id/reject", async (c) => {
    const taskId = c.req.param("id");
    const { reason } = await c.req.json().catch(() => ({ reason: undefined }));
    const task = await store.get(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    try {
      const updated = await store.update(taskId, { status: "cancelled", output: reason });
      telemetry?.emit({ type: "task_rejected", taskId, tenantId: task.tenantId, data: { reason } });
      return c.json(updated);
    } catch {
      return c.json({ error: "Cannot reject task" }, 400);
    }
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json();
    // targetDepartment/targetRole/targetSkill/afterId were silently dropped
    // here — create_task's caller could set them, but the row that actually
    // landed in the DB never carried them, so every subtask was untagged and
    // claimable by any worker in any department. `role` (the CREATING
    // agent's role, used only for the worker-can't-create-top-level-tasks
    // check below) is a distinct concept from `targetRole` (which
    // department/role the new task is FOR) — don't conflate them.
    const { tenantId, description, parentId, role, llmCallsBudget, maxAttempts,
            targetDepartment, targetRole, targetSkill, afterId } = body;
    const validation = fsm.validateCreation(parentId ?? null, role ?? "architect");
    if (!validation.valid) {
      return c.json({ error: validation.reason }, 403);
    }
    const task = await store.create({
      tenantId, description, parentId, llmCallsBudget, maxAttempts,
      targetDepartment, targetRole, targetSkill, afterId,
    });
    telemetry?.emit({ type: "task_created", taskId: task.id, tenantId, data: {} });
    return c.json(task, 201);
  });

  return app;
}
