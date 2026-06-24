import { test, expect, describe } from "bun:test";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { TraceStep } from "../types.ts";

describe("ExecutionTrace", () => {
  test("accumulates steps", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    const step: TraceStep = {
      phase: "plan",
      action: "generate_plan",
      durationMs: 100,
      timestamp: "2024-01-01T00:00:00Z",
    };

    trace.addStep(step);
    expect(trace.getSteps()).toHaveLength(1);
    expect(trace.getSteps()[0]).toEqual(step);
  });

  test("getSteps returns a copy", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    trace.addStep({ phase: "act", action: "test", durationMs: 0, timestamp: "2024-01-01T00:00:00Z" });

    const steps = trace.getSteps();
    steps.push({ phase: "observe", action: "extra", durationMs: 0, timestamp: "2024-01-01T00:00:00Z" });
    expect(trace.getSteps()).toHaveLength(1);
  });

  test("sums token usage across steps", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    trace.addStep({
      phase: "plan",
      action: "plan",
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      durationMs: 0,
      timestamp: "2024-01-01T00:00:00Z",
    });
    trace.addStep({
      phase: "act",
      action: "act",
      tokenUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      durationMs: 0,
      timestamp: "2024-01-01T00:00:00Z",
    });
    trace.addStep({
      phase: "observe",
      action: "observe",
      durationMs: 0,
      timestamp: "2024-01-01T00:00:00Z",
    });

    const usage = trace.getTokenUsage();
    expect(usage.promptTokens).toBe(300);
    expect(usage.completionTokens).toBe(150);
    expect(usage.totalTokens).toBe(450);
  });

  test("getDuration returns elapsed time", async () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    await Bun.sleep(10);
    expect(trace.getDuration()).toBeGreaterThanOrEqual(9);
  });

  test("isSuccessful returns false before outcome set", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    expect(trace.isSuccessful()).toBe(false);
  });

  test("isSuccessful returns true only for completed outcome", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");

    trace.setOutcome({ status: "escalated", reason: "failed" });
    expect(trace.isSuccessful()).toBe(false);

    trace.setOutcome({ status: "completed", output: "done" });
    expect(trace.isSuccessful()).toBe(true);
  });

  test("toJSON serializes all fields", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    trace.addStep({ phase: "plan", action: "test", durationMs: 50, timestamp: "2024-01-01T00:00:00Z" });
    trace.setOutcome({ status: "completed", output: "result" });

    const json = trace.toJSON() as any;
    expect(json.taskId).toBe("task-1");
    expect(json.agentId).toBe("agent-1");
    expect(json.steps).toHaveLength(1);
    expect(json.outcome.status).toBe("completed");
    expect(json.tokenUsage.totalTokens).toBe(0);
    expect(json.durationMs).toBeGreaterThanOrEqual(0);
  });
});
