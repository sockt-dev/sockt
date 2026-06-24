import { test, expect, describe } from "bun:test";
import { AgentRunner, ConfigBasedSelector } from "../runner/agent-runner.ts";
import { ToolRegistry } from "../tools/registry.ts";
import type { LlmClient, LlmRequest, LlmResponse, LlmMessage, LlmStreamChunk, AgentConfig, Task, HitlGate, ApprovalRequest, ApprovalDecision } from "@sockt/types";

const agent: AgentConfig = {
  id: "edge-agent",
  tenantId: "t1",
  name: "Edge Case Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "Test agent.",
  tools: [],
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: "t1",
    status: "in_progress",
    owner: "edge-agent",
    parentId: null,
    description: "Edge case test",
    output: null,
    llmCallsUsed: 0,
    llmCallsBudget: 100,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function simpleLlm(responses: string[]): LlmClient {
  let idx = 0;
  return {
    async chat(): Promise<LlmResponse> {
      const content = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return {
        message: { role: "assistant", content },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: "mock",
        finishReason: "stop",
      };
    },
    async *stream() { yield { delta: "" }; },
    async countTokens() { return 10; },
  };
}

function orchServer(budgetAllowed = true) {
  return Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ allowed: budgetAllowed, remaining: budgetAllowed ? 99 : 0 });
    },
  });
}

describe("AgentRunner - Edge Cases", () => {
  test("empty plan steps still triggers reflection", async () => {
    const server = orchServer();
    try {
      const llm = simpleLlm([
        '{"steps": []}',
        '{"complete": true, "output": "Nothing to do"}',
      ]);

      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: `http://localhost:${server.port}`,
      });

      const result = await runner.executeTask(agent, makeTask());
      expect(result.status).toBe("completed");
    } finally {
      server.stop();
    }
  });

  test("handles very large plan gracefully (respects maxPlanSteps)", async () => {
    const server = orchServer();
    try {
      const manySteps = Array.from({ length: 50 }, (_, i) => ({ description: `Step ${i}` }));
      const llm = simpleLlm([
        JSON.stringify({ steps: manySteps }),
        "Executed",
        '{"complete": true, "output": "Done with truncated plan"}',
      ]);

      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: `http://localhost:${server.port}`,
        maxPlanSteps: 5,
      });

      const result = await runner.executeTask(agent, makeTask());
      expect(result.status).toBe("completed");
    } finally {
      server.stop();
    }
  });

  test("tool that takes too long still returns", async () => {
    const server = orchServer();
    try {
      const registry = new ToolRegistry();
      registry.register(
        { name: "slow", description: "Slow tool", parameters: {} },
        async () => {
          await Bun.sleep(50);
          return "finally done";
        },
      );

      const llm = simpleLlm([
        '{"steps": [{"description": "Run slow tool", "tool": "slow", "args": {}}]}',
        '{"complete": true, "output": "Completed with slow tool"}',
      ]);

      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: registry,
        orchBaseUrl: `http://localhost:${server.port}`,
      });

      const result = await runner.executeTask(agent, makeTask());
      expect(result.status).toBe("completed");
    } finally {
      server.stop();
    }
  });

  test("non-existent tool in plan step falls back to LLM", async () => {
    const server = orchServer();
    try {
      const llm = simpleLlm([
        '{"steps": [{"description": "Use missing tool", "tool": "nonexistent", "args": {}}]}',
        "I'll handle this without the tool",
        '{"complete": true, "output": "Handled without tool"}',
      ]);

      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: `http://localhost:${server.port}`,
      });

      const result = await runner.executeTask(agent, makeTask());
      expect(result.status).toBe("completed");
    } finally {
      server.stop();
    }
  });

  test("concurrent task executions are independent", async () => {
    const server = orchServer();
    try {
      let call1Count = 0;
      let call2Count = 0;

      const llm1: LlmClient = {
        async chat(): Promise<LlmResponse> {
          call1Count++;
          if (call1Count === 1) return { message: { role: "assistant", content: '{"steps": [{"description": "A"}]}' }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" };
          if (call1Count === 2) { await Bun.sleep(30); return { message: { role: "assistant", content: "result A" }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" }; }
          return { message: { role: "assistant", content: '{"complete": true, "output": "A done"}' }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" };
        },
        async *stream() { yield { delta: "" }; },
        async countTokens() { return 10; },
      };

      const llm2: LlmClient = {
        async chat(): Promise<LlmResponse> {
          call2Count++;
          if (call2Count === 1) return { message: { role: "assistant", content: '{"steps": [{"description": "B"}]}' }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" };
          if (call2Count === 2) return { message: { role: "assistant", content: "result B" }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" };
          return { message: { role: "assistant", content: '{"complete": true, "output": "B done"}' }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, model: "m", finishReason: "stop" };
        },
        async *stream() { yield { delta: "" }; },
        async countTokens() { return 10; },
      };

      const runner1 = new AgentRunner({ llmClient: llm1, toolRegistry: new ToolRegistry(), orchBaseUrl: `http://localhost:${server.port}` });
      const runner2 = new AgentRunner({ llmClient: llm2, toolRegistry: new ToolRegistry(), orchBaseUrl: `http://localhost:${server.port}` });

      const [r1, r2] = await Promise.all([
        runner1.executeTask(agent, makeTask({ id: "task-A" })),
        runner2.executeTask(agent, makeTask({ id: "task-B" })),
      ]);

      expect(r1.status).toBe("completed");
      expect(r2.status).toBe("completed");
      if (r1.status === "completed") expect(r1.output).toBe("A done");
      if (r2.status === "completed") expect(r2.output).toBe("B done");
    } finally {
      server.stop();
    }
  });

  test("task with maxAttempts = 0 immediately escalates", async () => {
    const server = orchServer();
    try {
      const llm = simpleLlm(["should not be called"]);
      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: `http://localhost:${server.port}`,
      });

      const result = await runner.executeTask(agent, makeTask({ maxAttempts: 0 }));
      expect(result.status).toBe("escalated");
      if (result.status === "escalated") {
        expect(result.reason).toContain("Max attempts");
      }
    } finally {
      server.stop();
    }
  });

  test("HITL approval allows execution to continue", async () => {
    const server = orchServer();
    try {
      const registry = new ToolRegistry();
      registry.register(
        { name: "dangerous", description: "Dangerous op", parameters: {} },
        async () => "executed safely",
      );
      registry.setApprovalRequired(["dangerous"]);

      const hitlGate: HitlGate = {
        async requestApproval() { return "req-1"; },
        async checkApproval() { return "approved"; },
        async waitForApproval(): Promise<ApprovalDecision> {
          return { requestId: "req-1", status: "approved", decidedBy: "admin", decidedAt: "2024-01-01" };
        },
        async listPending() { return []; },
      };

      const llm = simpleLlm([
        '{"steps": [{"description": "Do dangerous thing", "tool": "dangerous", "args": {}}]}',
        '{"complete": true, "output": "Dangerous op completed safely"}',
      ]);

      const runner = new AgentRunner({
        llmClient: llm,
        toolRegistry: registry,
        orchBaseUrl: `http://localhost:${server.port}`,
        hitlGate,
      });

      const result = await runner.executeTask(agent, makeTask());
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.output).toBe("Dangerous op completed safely");
      }
    } finally {
      server.stop();
    }
  });
});

describe("ConfigBasedSelector", () => {
  test("returns the request config unchanged", async () => {
    const selector = new ConfigBasedSelector();
    const config = { provider: "openai" as const, model: "gpt-4", maxTokens: 1000 };
    const result = await selector.select(
      { messages: [], config, tools: [] },
      { taskId: "t1", tenantId: "t1", previousAttempts: 0, budgetRemaining: 100 },
    );
    expect(result).toEqual(config);
  });
});
