import { test, expect, describe, beforeEach } from "bun:test";
import { Scheduler } from "../scheduler/scheduler.ts";
import type { ScheduleConfig } from "../scheduler/scheduler.ts";
import type { Task, TaskCreate } from "@sockt/types";

const mockTask: Task = {
  id: "task-1",
  tenantId: "t1",
  status: "pending",
  owner: null,
  parentId: null,
  description: "Scheduled task",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 25,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let dispatched: { agentId: string; task: TaskCreate }[];
  let mockDispatch: (agentId: string, task: TaskCreate) => Promise<Task>;

  beforeEach(() => {
    dispatched = [];
    mockDispatch = async (agentId, task) => {
      dispatched.push({ agentId, task });
      return mockTask;
    };
    scheduler = new Scheduler(mockDispatch);
  });

  const makeSchedule = (overrides: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
    id: "sched-1",
    agentId: "agent-1",
    cron: "0 9 * * 1-5",
    taskDescription: "Daily standup",
    tenantId: "t1",
    enabled: true,
    ...overrides,
  });

  test("register adds a schedule to the list", () => {
    scheduler.register(makeSchedule());
    expect(scheduler.list()).toHaveLength(1);
  });

  test("list returns all registered schedules", () => {
    scheduler.register(makeSchedule({ id: "s1" }));
    scheduler.register(makeSchedule({ id: "s2" }));
    expect(scheduler.list()).toHaveLength(2);
  });

  test("trigger calls dispatch with correct args", async () => {
    scheduler.register(makeSchedule({ id: "s1", agentId: "agent-x", taskDescription: "Run report", tenantId: "t2" }));
    await scheduler.trigger("s1");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].agentId).toBe("agent-x");
    expect(dispatched[0].task.description).toBe("Run report");
    expect(dispatched[0].task.tenantId).toBe("t2");
  });

  test("trigger throws for unknown scheduleId", async () => {
    expect(scheduler.trigger("nonexistent")).rejects.toThrow();
  });

  test("start and stop lifecycle does not throw", () => {
    scheduler.register(makeSchedule());
    expect(() => scheduler.start()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test("disabled schedule can still be manually triggered", async () => {
    scheduler.register(makeSchedule({ id: "s1", enabled: false }));
    await scheduler.trigger("s1");
    expect(dispatched).toHaveLength(1);
  });

  test("register multiple schedules with different cron expressions", () => {
    scheduler.register(makeSchedule({ id: "s1", cron: "0 9 * * *" }));
    scheduler.register(makeSchedule({ id: "s2", cron: "0 17 * * *" }));
    const list = scheduler.list();
    expect(list[0].cron).toBe("0 9 * * *");
    expect(list[1].cron).toBe("0 17 * * *");
  });
});
