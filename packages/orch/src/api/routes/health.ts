import { Hono } from "hono";
import type { SqliteTaskStore } from "@sockt/fsm";
import type { LockManager } from "../../lock/lock-manager.ts";

export interface HealthRouteDeps {
  store: SqliteTaskStore;
  lockManager: LockManager;
  startTime: number;
}

export function healthRoutes(deps: HealthRouteDeps): Hono {
  const { store, lockManager, startTime } = deps;
  const app = new Hono();

  app.get("/health", async (c) => {
    const activeLocks = lockManager.getActiveLocks();
    let activeAgents = 0;
    for (const tasks of activeLocks.values()) {
      if (tasks.size > 0) activeAgents++;
    }

    return c.json({
      status: "healthy",
      uptime: Date.now() - startTime,
      activeAgents,
      pendingTasks: 0,
    });
  });

  return app;
}
