import cron from "node-cron";
import type { Task, TaskCreate } from "@sockt/types";

export interface ScheduleConfig {
  id: string;
  agentId: string;
  cron: string;
  taskDescription: string;
  tenantId: string;
  enabled: boolean;
}

export class Scheduler {
  private schedules = new Map<string, ScheduleConfig>();
  private jobs = new Map<string, cron.ScheduledTask>();
  private readonly dispatch: (agentId: string, task: TaskCreate) => Promise<Task>;

  constructor(dispatch: (agentId: string, task: TaskCreate) => Promise<Task>) {
    this.dispatch = dispatch;
  }

  register(config: ScheduleConfig): void {
    this.schedules.set(config.id, config);
  }

  start(): void {
    for (const [id, config] of this.schedules) {
      if (!config.enabled) continue;
      const job = cron.schedule(config.cron, () => {
        this.dispatch(config.agentId, {
          tenantId: config.tenantId,
          description: config.taskDescription,
        });
      });
      this.jobs.set(id, job);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  list(): ScheduleConfig[] {
    return [...this.schedules.values()];
  }

  async trigger(scheduleId: string): Promise<void> {
    const config = this.schedules.get(scheduleId);
    if (!config) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }
    await this.dispatch(config.agentId, {
      tenantId: config.tenantId,
      description: config.taskDescription,
    });
  }
}
