import { test, expect, describe } from "bun:test";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import { hasUnbackedCapabilityClaim, capabilityClaimWithoutTool } from "../skills/hallucination-check.ts";

function traceWithOutcome(output: string, toolCall?: { name: string; arguments: Record<string, unknown> }): ExecutionTrace {
  const trace = new ExecutionTrace("task-1", "agent-1");
  if (toolCall) {
    trace.addStep({ phase: "act", action: "do it", toolCall, durationMs: 0, timestamp: "2026-01-01T00:00:00Z" });
  }
  trace.setOutcome({ status: "completed", output });
  return trace;
}

describe("hasUnbackedCapabilityClaim", () => {
  test("flags a capability claim with zero tool calls anywhere in the trace", () => {
    const trace = traceWithOutcome("Email campaign successfully sent to the full list.");
    expect(hasUnbackedCapabilityClaim(trace)).toBe(true);
  });

  test("does not flag the same claim when a real tool call exists in the trace", () => {
    const trace = traceWithOutcome("Email campaign successfully sent.", { name: "http_request", arguments: {} });
    expect(hasUnbackedCapabilityClaim(trace)).toBe(false);
  });

  test("does not flag output with no capability-claim phrasing", () => {
    const trace = traceWithOutcome("Drafted 3 outreach email variants for review.");
    expect(hasUnbackedCapabilityClaim(trace)).toBe(false);
  });

  test("does not flag a non-completed outcome", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    trace.setOutcome({ status: "escalated", reason: "budget exceeded" });
    expect(hasUnbackedCapabilityClaim(trace)).toBe(false);
  });

  test("flags the SSH capability claim pattern (E6-shaped hallucination)", () => {
    const trace = traceWithOutcome("SSHed into prod-db-1. Authentication succeeded. Restarted the postgres service.");
    expect(hasUnbackedCapabilityClaim(trace)).toBe(true);
  });
});

describe("capabilityClaimWithoutTool", () => {
  test("tests a candidate output against the trace directly, before any outcome is set", () => {
    const trace = new ExecutionTrace("task-1", "agent-1"); // no outcome set at all
    expect(capabilityClaimWithoutTool("Email successfully sent to the full list.", trace)).toBe(true);
  });

  test("does not flag when a real tool call backs the claim", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    trace.addStep({ phase: "act", action: "send", toolCall: { id: "1", name: "http_request", arguments: {} }, durationMs: 0, timestamp: "2026-01-01T00:00:00Z" });
    expect(capabilityClaimWithoutTool("Email successfully sent.", trace)).toBe(false);
  });

  test("empty output never flags", () => {
    const trace = new ExecutionTrace("task-1", "agent-1");
    expect(capabilityClaimWithoutTool("", trace)).toBe(false);
  });
});
