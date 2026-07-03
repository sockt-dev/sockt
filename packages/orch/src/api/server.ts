import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import type { TelemetryEmitter } from "@sockt/types";
import type { LockManager } from "../lock/lock-manager.ts";
import type { AgentRegistry } from "../registry/agent-registry.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { approvalRoutes } from "./routes/approvals.ts";
import { healthRoutes } from "./routes/health.ts";
import { agentRoutes } from "./routes/agents.ts";
import { ApprovalStore } from "./approval-store.ts";

export interface OrchestratorApiDeps {
  store: SqliteTaskStore;
  fsm: FsmEngine;
  claimLock: TaskClaimLock;
  lockManager: LockManager;
  registry: AgentRegistry;
  telemetry?: TelemetryEmitter;
}

export class OrchestratorApi {
  private readonly app: Hono;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly startTime = Date.now();

  constructor(deps: OrchestratorApiDeps) {
    this.app = new Hono();
    const approvalStore = new ApprovalStore();

    this.app.use("*", cors());

    const tasks = taskRoutes({
      store: deps.store,
      fsm: deps.fsm,
      claimLock: deps.claimLock,
      lockManager: deps.lockManager,
      telemetry: deps.telemetry,
    });

    const approvals = approvalRoutes(approvalStore);
    const agents    = agentRoutes(deps.registry);

    const health = healthRoutes({
      store: deps.store,
      lockManager: deps.lockManager,
      startTime: this.startTime,
    });

    this.app.route("/", tasks);
    this.app.route("/", approvals);
    this.app.route("/", agents);
    this.app.route("/", health);

    this.app.notFound((c) => c.json({ error: "Not found" }, 404));
  }

  getApp(): Hono {
    return this.app;
  }

  async listen(port: number): Promise<void> {
    this.server = Bun.serve({
      port,
      fetch: this.app.fetch,
    });
  }

  getPort(): number {
    return this.server?.port ?? 0;
  }

  async close(): Promise<void> {
    this.server?.stop();
    this.server = null;
  }
}
