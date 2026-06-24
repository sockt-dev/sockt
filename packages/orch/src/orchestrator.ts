import type { Database } from "bun:sqlite";
import type { AgentConfig, ChannelGateway, TelemetryEmitter, HitlGate, InboundMessage, Task, TaskCreate } from "@sockt/types";
import { SqliteTaskStore, FsmEngine, TaskClaimLock } from "@sockt/fsm";
import { OrchestratorApi } from "./api/server.ts";
import { LockManager } from "./lock/lock-manager.ts";
import { AgentRegistry } from "./registry/agent-registry.ts";
import { MessageRouter } from "./router/message-router.ts";
import { Scheduler } from "./scheduler/scheduler.ts";
import type { ScheduleConfig } from "./scheduler/scheduler.ts";
import { DepartmentManager } from "./registry/department-manager.ts";
import type { DepartmentTemplate } from "./registry/department-manager.ts";

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
    this.registry = new AgentRegistry(config.agents);
    this.router = new MessageRouter(this.registry);
    this.scheduler = new Scheduler(this.dispatch.bind(this));

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
      telemetry: config.telemetry,
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
    const agents = this.router.route(message);
    for (const agent of agents) {
      await this.store.create({
        tenantId: message.tenantId,
        description: message.content,
      });
      this.config.telemetry?.emit({
        type: "task_created",
        tenantId: message.tenantId,
        data: { agentId: agent.id, source: "message" },
      });
    }
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
