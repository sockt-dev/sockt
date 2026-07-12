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
  /** Fired once per approval, HITL_REMINDER_LEAD_MS before it times out —
   * see ApprovalStore.sweepReminders. Never fires for approvals with no
   * timeoutAt (unset timeout = no reminder, since there's nothing to remind
   * before). */
  onApprovalReminder?: (approval: StoredApproval) => void;
  /** Fired once an approval actually times out (sweepTimeouts), distinct
   * from onApprovalReminder — lets serve.ts post a "re-request?" prompt
   * instead of just a passive reminder. */
  onApprovalTimeout?: (approval: StoredApproval) => void;
  taskOriginStore?: TaskOriginStore;
  /** When set, every route except /health requires `Authorization: Bearer
   * <apiToken>`. Unset (the default) preserves the existing no-auth local-dev
   * behavior documented in SECURITY.md #5 — this is opt-in, not a breaking
   * change. A plain string compare, not constant-time: proportional to this
   * being a self-hosted opt-in floor (SECURITY.md still recommends a reverse
   * proxy with real auth for anything beyond localhost), not a defense against
   * a timing-attack-capable adversary already on the same network segment. */
  apiToken?: string;
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

    if (deps.apiToken) {
      const expected = `Bearer ${deps.apiToken}`;
      this.app.use("*", async (c, next) => {
        if (c.req.path === "/health") return next(); // liveness stays open for basic monitoring
        if (c.req.header("Authorization") !== expected) {
          return c.json({ error: "Unauthorized" }, 401);
        }
        await next();
      });
    }

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
    this.sweepInterval = setInterval(async () => {
      const reminderLeadMs = Number(process.env.HITL_REMINDER_LEAD_MS ?? 120_000);
      for (const a of this.approvalStore.sweepReminders(reminderLeadMs)) {
        deps.onApprovalReminder?.(a);
      }

      const swept = this.approvalStore.sweepTimeouts();
      for (const a of swept) deps.onApprovalTimeout?.(a);
      if (swept.length > 0) {
        console.log(`[orch] swept ${swept.length} timed-out approval(s)`);
      }

      // A subtask ordered `after` a sibling that itself escalated/was
      // cancelled can never satisfy listPending's "dependency completed"
      // filter — it would otherwise sit pending forever, invisible to every
      // worker, with nothing ever telling anyone it's stuck. Cancel it
      // outright with a reason pointing at the dead dependency.
      const dead = await deps.store.listPendingWithDeadDependency();
      for (const t of dead) {
        try {
          await deps.store.update(t.id, {
            status: "cancelled",
            output: `Dependency ${t.afterId} failed (escalated or cancelled) — this subtask can never run.`,
          });
          deps.telemetry?.emit({ type: "task_cancelled", taskId: t.id, tenantId: t.tenantId, data: { reason: "dead_dependency", afterId: t.afterId } });
        } catch (err) {
          console.error(`[orch] failed to cancel dead-dependency task=${t.id}:`, err);
        }
      }
      if (dead.length > 0) {
        console.log(`[orch] cancelled ${dead.length} task(s) with a dead dependency`);
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
