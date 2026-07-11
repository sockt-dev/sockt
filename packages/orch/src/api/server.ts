import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "bun:sqlite";
import type { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import type { TelemetryEmitter } from "@sockt/types";
import type { LockManager } from "../lock/lock-manager.ts";
import type { AgentRegistry } from "../registry/agent-registry.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { approvalRoutes } from "./routes/approvals.ts";
import { healthRoutes } from "./routes/health.ts";
import { agentRoutes } from "./routes/agents.ts";
import { ApprovalStore } from "./approval-store.ts";
import type { StoredApproval } from "./approval-store.ts";
import { QuestionStore } from "./question-store.ts";
import type { TaskOriginStore } from "../store/task-origin-store.ts";

export interface OrchestratorApiDeps {
  store: SqliteTaskStore;
  fsm: FsmEngine;
  claimLock: TaskClaimLock;
  lockManager: LockManager;
  registry: AgentRegistry;
  db: Database;
  telemetry?: TelemetryEmitter;
  onApprovalCreated?: (approval: StoredApproval) => void;
  taskOriginStore?: TaskOriginStore;
}

const TIMEOUT_SWEEP_INTERVAL_MS = 30_000;

export class OrchestratorApi {
  private readonly app: Hono;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly startTime = Date.now();
  private readonly approvalStore: ApprovalStore;
  private readonly questionStore: QuestionStore;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: OrchestratorApiDeps) {
    this.app = new Hono();
    this.approvalStore = new ApprovalStore(deps.db);
    this.questionStore = new QuestionStore(deps.db);

    this.app.use("*", cors());

    const tasks = taskRoutes({
      store: deps.store,
      fsm: deps.fsm,
      claimLock: deps.claimLock,
      lockManager: deps.lockManager,
      telemetry: deps.telemetry,
      questionStore: this.questionStore,
      taskOriginStore: deps.taskOriginStore,
    });

    const approvals = approvalRoutes(this.approvalStore, deps.onApprovalCreated);
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

    // Belt-and-braces with HttpHitlGate's own client-side poll deadline: if
    // the polling client is dead or partitioned when its deadline passes, the
    // approval would otherwise sit "pending" forever. checkHitlApproval in
    // agent-runner.ts fails closed on any non-"approved" status, so a swept
    // timeout still results in the gated tool NOT running.
    this.sweepInterval = setInterval(() => {
      const swept = this.approvalStore.sweepTimeouts();
      if (swept.length > 0) {
        console.log(`[orch] swept ${swept.length} timed-out approval(s)`);
      }
    }, TIMEOUT_SWEEP_INTERVAL_MS);
  }

  getApp(): Hono {
    return this.app;
  }

  /** Used by Orchestrator.handleMessage's thread-reply interception to check
   * for a pending clarifying question before routing a message as new. */
  getQuestionStore(): QuestionStore {
    return this.questionStore;
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
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    this.server?.stop();
    this.server = null;
  }
}
