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
  description: "test",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 25,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("Scheduler — edge cases", () => {
  let scheduler: Scheduler;
  let dispatched: { agentId: string; task: TaskCreate }[];

  beforeEach(() => {
    dispatched = [];
    scheduler = new Scheduler(async (agentId, task) => {
      dispatched.push({ agentId, task });
      return mockTask;
    });
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

  test("register same id twice overwrites", () => {
    scheduler.register(makeSchedule({ id: "s1", taskDescription: "first" }));
    scheduler.register(makeSchedule({ id: "s1", taskDescription: "second" }));
    expect(scheduler.list()).toHaveLength(1);
    expect(scheduler.list()[0].taskDescription).toBe("second");
  });

  test("trigger multiple times dispatches each time", async () => {
    scheduler.register(makeSchedule({ id: "s1" }));
    await scheduler.trigger("s1");
    await scheduler.trigger("s1");
    await scheduler.trigger("s1");
    expect(dispatched).toHaveLength(3);
  });

  test("many schedules registered and listed", () => {
    for (let i = 0; i < 100; i++) {
      scheduler.register(makeSchedule({ id: `sched-${i}`, cron: `${i % 60} * * * *` }));
    }
    expect(scheduler.list()).toHaveLength(100);
  });

  test("start with no schedules is no-op", () => {
    expect(() => scheduler.start()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test("stop before start is no-op", () => {
    scheduler.register(makeSchedule());
    expect(() => scheduler.stop()).not.toThrow();
  });

  test("start then stop then start again is safe", () => {
    scheduler.register(makeSchedule());
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
  });

  test("dispatch failure during trigger propagates error", async () => {
    const failScheduler = new Scheduler(async () => {
      throw new Error("dispatch failed");
    });
    failScheduler.register(makeSchedule({ id: "s1" }));
    expect(failScheduler.trigger("s1")).rejects.toThrow("dispatch failed");
  });

  test("task description with special characters", async () => {
    scheduler.register(makeSchedule({
      id: "s1",
      taskDescription: 'Run report for "Q3" <2024> & send to @team',
    }));
    await scheduler.trigger("s1");
    expect(dispatched[0].task.description).toBe('Run report for "Q3" <2024> & send to @team');
  });
});
