import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { preflightCheck } from "../runner/preflight.ts";
import type { AgentConfig, Task } from "@sockt/types";

const growthAgent: AgentConfig = {
  id: "growth-worker-1", tenantId: "t1", name: "growth worker", role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" }, systemPrompt: "sys", tools: [], department: "growth",
};

const productAgent: AgentConfig = { ...growthAgent, id: "product-worker-1", department: "product" };

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1", tenantId: "t1", status: "in_progress", owner: "a1", parentId: null,
    description: "Generate a list of leads for our new pricing tier", output: null,
    llmCallsUsed: 0, llmCallsBudget: 25, attemptCount: 0, maxAttempts: 3,
    targetDepartment: null, targetRole: null, targetSkill: null, afterId: null,
    createdAt: "", updatedAt: "", ...overrides,
  } as Task;
}

describe("preflightCheck", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.GROWTH_REQUIRE_SEARCH_API;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("asks a clarifying question for a growth lead-gen task with no search API key", () => {
    const result = preflightCheck(growthAgent, mockTask());
    expect(result?.status).toBe("needs_input");
  });

  test("passes through when a search API key is configured", () => {
    process.env.TAVILY_API_KEY = "test-key";
    const result = preflightCheck(growthAgent, mockTask());
    expect(result).toBeNull();
  });

  test("passes through when BRAVE_SEARCH_API_KEY is configured instead", () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    const result = preflightCheck(growthAgent, mockTask());
    expect(result).toBeNull();
  });

  test("GROWTH_REQUIRE_SEARCH_API=false disables the check", () => {
    process.env.GROWTH_REQUIRE_SEARCH_API = "false";
    const result = preflightCheck(growthAgent, mockTask());
    expect(result).toBeNull();
  });

  test("does not fire for non-growth departments", () => {
    const result = preflightCheck(productAgent, mockTask());
    expect(result).toBeNull();
  });

  test("does not fire for a growth task that isn't lead-gen shaped", () => {
    const result = preflightCheck(growthAgent, mockTask({ description: "Write outreach copy for the new pricing tier" }));
    expect(result).toBeNull();
  });

  test("fires when targetSkill is explicitly lead-generation even if the description is generic", () => {
    const result = preflightCheck(growthAgent, mockTask({ description: "Do the thing", targetSkill: "lead-generation" }));
    expect(result?.status).toBe("needs_input");
  });
});
