import type { Database } from "bun:sqlite";
import type { AgentConfig, AgentRole, ChannelGateway, TelemetryEmitter, HitlGate, InboundMessage, Task, TaskCreate } from "@sockt/types";
import { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import { OrchestratorApi } from "./api/server.ts";
import { LockManager } from "./lock/lock-manager.ts";
import { AgentRegistry } from "./registry/agent-registry.ts";
import { MessageRouter } from "./router/message-router.ts";
import { Scheduler } from "./scheduler/scheduler.ts";
import type { ScheduleConfig } from "./scheduler/scheduler.ts";
import { DepartmentManager } from "./registry/department-manager.ts";
import type { DepartmentTemplate } from "./registry/department-manager.ts";
import { TaskOriginStore } from "./store/task-origin-store.ts";
import type { StoredApproval } from "./api/approval-store.ts";

export interface OrchestratorConfig {
  port: number;
  dbPath: string;
  db?: Database;
  agents: AgentConfig[];
  channelGateway?: ChannelGateway;
  telemetry?: TelemetryEmitter;
  hitlGate?: HitlGate;
  schedules?: ScheduleConfig[];
  departments?: DepartmentConfig[];
  routing?: RoutingConfig;
  /** Fired synchronously right after an approval row is created (before the
   * HTTP response goes out) — used by serve.ts to post the Slack approve/deny
   * message via SlackHitlBridge, looking up the triggering task's channel via
   * its own TaskOriginStore (same db handle as this Orchestrator's). */
  onApprovalCreated?: (approval: StoredApproval) => void;
  /** Passed straight through to OrchestratorApi — see its apiToken doc. */
  apiToken?: string;
}

export interface RoutingConfig {
  channelRoutes?: { channelId: string; department: string; role: AgentRole }[];
  contentRoutes?: { pattern: RegExp; department: string; role: AgentRole }[];
}

export interface DepartmentConfig {
  name: string;
  tenantId: string;
  template: DepartmentTemplate;
}

export interface OrchestratorHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  activeAgents: number;
  pendingTasks: number;
}

export class Orchestrator {
  private readonly config: OrchestratorConfig;
  private readonly store: SqliteTaskStore;
  private readonly fsm: FsmEngine;
  private readonly claimLock: TaskClaimLock;
  private readonly lockManager: LockManager;
  private readonly registry: AgentRegistry;
  private readonly router: MessageRouter;
  private readonly scheduler: Scheduler;
  private readonly api: OrchestratorApi;
  private readonly taskOriginStore: TaskOriginStore;
  private readonly startTime = Date.now();
  private port = 0;

  constructor(config: OrchestratorConfig) {
    this.config = config;

    const db = config.db ?? (() => {
      const { Database } = require("bun:sqlite");
      return new Database(config.dbPath);
    })();

    this.store = new SqliteTaskStore(db);
    this.fsm = new FsmEngine(this.store);
    this.claimLock = new TaskClaimLock(db);
    this.lockManager = new LockManager();
    this.taskOriginStore = new TaskOriginStore(db);
    this.registry = new AgentRegistry(config.agents);
    this.router = new MessageRouter(this.registry);
    this.scheduler = new Scheduler(this.dispatch.bind(this));

    if (config.routing?.channelRoutes) {
      for (const r of config.routing.channelRoutes) {
        this.router.addChannelRoute(r.channelId, r.department, r.role);
      }
    }
    if (config.routing?.contentRoutes) {
      for (const r of config.routing.contentRoutes) {
        this.router.addContentRoute(r.pattern, r.department, r.role);
      }
    }

    if (config.schedules) {
      for (const schedule of config.schedules) {
        this.scheduler.register(schedule);
      }
    }

    if (config.departments) {
      const deptManager = new DepartmentManager(this.registry);
      for (const dept of config.departments) {
        deptManager.createFromTemplate(dept.template, dept.tenantId);
      }
    }

    this.api = new OrchestratorApi({
      store: this.store,
      fsm: this.fsm,
      claimLock: this.claimLock,
      lockManager: this.lockManager,
      registry: this.registry,
      db,
      telemetry: config.telemetry,
      onApprovalCreated: config.onApprovalCreated,
      taskOriginStore: this.taskOriginStore,
      apiToken: config.apiToken,
    });

    if (config.channelGateway) {
      config.channelGateway.onMessage((msg) => this.handleMessage(msg));
    }
  }

  async start(): Promise<void> {
    await this.api.listen(this.config.port);
    this.port = this.api.getPort();
    this.scheduler.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.api.close();
    if (this.config.channelGateway) {
      await this.config.channelGateway.disconnect();
    }
  }

  async handleMessage(message: InboundMessage): Promise<void> {
    // A threaded reply might be answering a clarifying question the agent
    // asked (see ask_user.ts / POST /tasks/:id/request-input) rather than a
    // new request — check before routing so it doesn't get treated as one.
    if (message.threadId) {
      const pendingQuestion = this.api
        .getQuestionStore()
        .findPendingByThread(message.tenantId, message.channelId, message.threadId);
      if (pendingQuestion) {
        await this.resumeFromAnswer(pendingQuestion.id, pendingQuestion.taskId, pendingQuestion.question, message.content);
        return;
      }
    }

    const agents = this.router.route(message);
    for (const agent of agents) {
      const created = await this.store.create({
        tenantId: message.tenantId,
        description: message.content,
        targetDepartment: agent.department,
        targetRole: agent.role,
      });
      // Persisted (not just in-memory) so a reply can still be routed after
      // an orch restart, and so a threaded reply can later be matched back to
      // this task (clarifying-question resume — see Step 5). Previously this
      // correlation only lived in SlackReplyTelemetry's in-memory Map, a
      // documented limitation confirmed by mechanical probe M3 in the
      // 2026-07-11 eval pass.
      this.taskOriginStore.create({
        taskId: created.id,
        tenantId: message.tenantId,
        platform: message.platform,
        channelId: message.channelId,
        threadId: message.threadId ?? null,
      });
      // channelId/threadId/platform let a telemetry consumer (e.g. the Slack
      // reply bridge in serve.ts) correlate this task back to where the
      // triggering message came from, so completion can be replied to.
      this.config.telemetry?.emit({
        type: "task_created",
        taskId: created.id,
        tenantId: message.tenantId,
        data: {
          agentId: agent.id,
          source: "message",
          platform: message.platform,
          channelId: message.channelId,
          threadId: message.threadId,
        },
      });
    }
  }

  /** Marks the pending question answered, appends the answer to the task's
   * description (the next Plan phase reads it from there — tasks have no
   * separate "conversation" field), and resumes blocked -> pending so the
   * task gets reclaimed. owner must be cleared explicitly: fsm.transition
   * only patches status (see FsmEngine.transition), and claimStmt requires
   * `owner IS NULL` — the same requirement that made /retry and /approve
   * need an explicit owner:null patch. */
  private async resumeFromAnswer(questionId: string, taskId: string, question: string, answer: string): Promise<void> {
    this.api.getQuestionStore().answer(questionId, answer);

    const task = await this.store.get(taskId);
    if (!task) return;

    const description = `${task.description}\n\nHuman answered "${question}": ${answer}`;
    await this.store.update(taskId, { description });

    try {
      await this.fsm.transition(taskId, "blocked", "pending", "system:answer");
      await this.store.update(taskId, { owner: null });
      this.config.telemetry?.emit({
        type: "task_input_received",
        taskId,
        tenantId: task.tenantId,
        data: { question, answer },
      });
    } catch {
      // Task was no longer blocked (already resumed some other way) — the
      // answer is still recorded and appended to the description above.
    }
  }

  /** Looked up by SlackReplyTelemetry as a fallback when its in-memory
   * per-process correlation doesn't have an entry (e.g. after an orch
   * restart). Also used by the clarifying-question resume flow. */
  getTaskOrigin(taskId: string) {
    return this.taskOriginStore.get(taskId);
  }

  async dispatch(_agentId: string, task: TaskCreate): Promise<Task> {
    const created = await this.store.create(task);
    this.config.telemetry?.emit({
      type: "task_created",
      taskId: created.id,
      tenantId: task.tenantId,
      data: { agentId: _agentId },
    });
    return created;
  }

  health(): OrchestratorHealth {
    const activeLocks = this.lockManager.getActiveLocks();
    let activeAgents = 0;
    for (const tasks of activeLocks.values()) {
      if (tasks.size > 0) activeAgents++;
    }

    return {
      status: "healthy",
      uptime: Date.now() - this.startTime,
      activeAgents,
      pendingTasks: 0,
    };
  }

  getPort(): number {
    return this.port;
  }
}
