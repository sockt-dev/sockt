import { test, expect, describe } from "bun:test";
import { planPhase } from "../runner/plan.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { LlmClient, LlmRequest, LlmResponse, AgentConfig, Task } from "@sockt/types";

// Regression coverage for the 2026-07-11 eval finding: the plan-generation
// prompt never told the model what tools actually exist, so it invented
// plausible-sounding names ("Python", "SSH client", ...) that never matched
// the registry and silently degraded every "act" step to fictional narration.

const agent: AgentConfig = {
  id: "plan-test-agent",
  tenantId: "tenant-plan",
  name: "Plan Test Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "You are a task-executing agent.",
  tools: [],
};

const task: Task = {
  id: "plan-test-task",
  tenantId: "tenant-plan",
  status: "in_progress",
  owner: "plan-test-agent",
  parentId: null,
  description: "Plan test task",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 25,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function llmThatReturns(content: string): { client: LlmClient; capturedPrompt: () => string; capturedAllMessages: () => string } {
  let lastPrompt = "";
  let allMessages = "";
  const client: LlmClient = {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const last = req.messages[req.messages.length - 1];
      lastPrompt = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
      allMessages = req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n---\n");
      return {
        message: { role: "assistant", content },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        model: "mock",
        finishReason: "stop",
      };
    },
    async *stream() { yield { delta: "chunk" }; },
    async countTokens() { return 10; },
  };
  return { client, capturedPrompt: () => lastPrompt, capturedAllMessages: () => allMessages };
}

function makeContext() {
  return {
    agent,
    task,
    messages: [{ role: "system" as const, content: "sys" }],
    trace: new ExecutionTrace(task.id, agent.id),
    budgetRemaining: 10,
    signal: new AbortController().signal,
    matchedSkills: [],
    gateFeedback: [] as string[],
  };
}

describe("planPhase tool grounding", () => {
  test("prompt lists real registered tool names and descriptions", async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "web_search", description: "Search the web for information.", parameters: {} },
      async () => "ok",
    );
    registry.register(
      { name: "exec_code", description: "Execute a code snippet in an isolated sandbox.", parameters: {} },
      async () => "ok",
    );

    const { client, capturedPrompt } = llmThatReturns('{"steps": [{"description": "do it"}]}');
    await planPhase(makeContext(), client, 5, registry);

    const prompt = capturedPrompt();
    expect(prompt).toContain('"web_search"');
    expect(prompt).toContain('"exec_code"');
    expect(prompt).toContain("Search the web for information.");
  });

  test("a step naming a tool that isn't registered has the tool field dropped, not passed through", async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "exec_code", description: "Execute code.", parameters: {} },
      async () => "ok",
    );

    const { client } = llmThatReturns(
      '{"steps": [{"description": "run the script", "tool": "Python", "args": {}}]}',
    );
    const result = await planPhase(makeContext(), client, 5, registry);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.tool).toBeUndefined();
    expect(result.steps[0]!.description).toContain('dropped invalid tool name "Python"');
  });

  test("a step naming a real registered tool passes through untouched", async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "exec_code", description: "Execute code.", parameters: {} },
      async () => "ok",
    );

    const { client } = llmThatReturns(
      '{"steps": [{"description": "run the script", "tool": "exec_code", "args": {"language": "python"}}]}',
    );
    const result = await planPhase(makeContext(), client, 5, registry);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.tool).toBe("exec_code");
  });

  test("empty registry tells the model no tools are available", async () => {
    const registry = new ToolRegistry();
    const { client, capturedPrompt } = llmThatReturns('{"steps": [{"description": "do it"}]}');
    await planPhase(makeContext(), client, 5, registry);

    expect(capturedPrompt()).toContain("No tools are available");
  });

  test("a plan whose every step names an invalid tool still returns those steps (tool stripped, not silently emptied)", async () => {
    // Guards against trading "fabricates a tool result" for "silently no-ops
    // to completed" — dropping an invalid tool name must never drop the step
    // itself, since an empty plan.steps would let the runner call the task
    // done with nothing actually attempted.
    const registry = new ToolRegistry();
    registry.register({ name: "exec_code", description: "Execute code.", parameters: {} }, async () => "ok");

    const { client } = llmThatReturns(
      '{"steps": [{"description": "step one", "tool": "Python"}, {"description": "step two", "tool": "SSH client"}]}',
    );
    const result = await planPhase(makeContext(), client, 5, registry);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.tool === undefined)).toBe(true);
  });

  test("a pending output-gate failure from ctx.gateFeedback is surfaced to the model", async () => {
    // planHistory is trimmed to the system prompt only by default
    // (PLAN_CONTEXT_MESSAGES=0) — without explicit injection, gate feedback
    // from a prior failed attempt would never reach this Plan call.
    const registry = new ToolRegistry();
    const { client, capturedAllMessages } = llmThatReturns('{"steps": [{"description": "retry"}]}');
    const ctx = makeContext();
    ctx.gateFeedback.push("Your previous attempt produced output that FAILED mechanical verification. Fix ALL of these before finishing:\n- Message is under 150 words: found 200 words.");

    await planPhase(ctx, client, 5, registry);

    expect(capturedAllMessages()).toContain("FAILED mechanical verification");
    expect(capturedAllMessages()).toContain("found 200 words");
  });

  test("no gate feedback message is added when ctx.gateFeedback is empty", async () => {
    const registry = new ToolRegistry();
    const { client, capturedAllMessages } = llmThatReturns('{"steps": [{"description": "do it"}]}');
    await planPhase(makeContext(), client, 5, registry);
    expect(capturedAllMessages()).not.toContain("FAILED mechanical verification");
  });
});
