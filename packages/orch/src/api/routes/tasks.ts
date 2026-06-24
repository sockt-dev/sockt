import { Hono } from "hono";
import type { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import type { LockManager } from "../../lock/lock-manager.ts";
import type { TelemetryEmitter } from "@sockt/types";

export interface TaskRouteDeps {
  store: SqliteTaskStore;
  fsm: FsmEngine;
  claimLock: TaskClaimLock;
  lockManager: LockManager;
  telemetry?: TelemetryEmitter;
}

export function taskRoutes(deps: TaskRouteDeps): Hono {
  const { store, fsm, claimLock, lockManager, telemetry } = deps;
  const app = new Hono();

  app.post("/tasks/claim", async (c) => {
    const { taskId, agentId } = await c.req.json();
    const task = await claimLock.attemptClaim(taskId, agentId);
    if (!task) {
      return c.json({ error: "Task unavailable" }, 409);
    }
    lockManager.acquire(agentId, taskId);
    telemetry?.emit({ type: "task_claimed", taskId, tenantId: task.tenantId, data: { agentId } });
    return c.json(task);
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
      }
    }
    return c.json(result);
  });

  app.get("/tasks/pending", async (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) {
      return c.json({ error: "tenantId query parameter required" }, 400);
    }
    const tasks = await store.listPending(tenantId);
    return c.json(tasks);
  });

  app.post("/tasks", async (c) => {
    const body = await c.req.json();
    const { tenantId, description, parentId, role, llmCallsBudget, maxAttempts } = body;
    const validation = fsm.validateCreation(parentId ?? null, role ?? "architect");
    if (!validation.valid) {
      return c.json({ error: validation.reason }, 403);
    }
    const task = await store.create({ tenantId, description, parentId, llmCallsBudget, maxAttempts });
    telemetry?.emit({ type: "task_created", taskId: task.id, tenantId, data: {} });
    return c.json(task, 201);
  });

  return app;
}
