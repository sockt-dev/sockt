import { test, expect, describe } from "bun:test";
import { AgentRunner } from "../runner/agent-runner.ts";
import { ToolRegistry } from "../tools/registry.ts";
import type { LlmClient, LlmRequest, LlmResponse, LlmMessage, LlmStreamChunk, AgentConfig, Task } from "@sockt/types";
import type { AgentRunnerConfig } from "../types.ts";

function createMockLlmClient(responses: string[]): LlmClient {
  let callIndex = 0;

  return {
    async chat(_request: LlmRequest): Promise<LlmResponse> {
      const content = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return {
        message: { role: "assistant", content },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: "mock-model",
        finishReason: "stop",
      };
    },
    async *stream(_request: LlmRequest): AsyncIterable<LlmStreamChunk> {
      yield { delta: "mock" };
    },
    async countTokens(_messages: LlmMessage[]): Promise<number> {
      return 100;
    },
  };
}

function createMockOrchServer(): { server: ReturnType<typeof Bun.serve>; url: string } {
  let budgetRemaining = 100;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/record-llm-call")) {
        budgetRemaining--;
        return Response.json({ allowed: budgetRemaining >= 0, remaining: Math.max(0, budgetRemaining) });
      }
      return Response.json({}, { status: 200 });
    },
  });

  return { server, url: `http://localhost:${server.port}` };
}

const mockAgent: AgentConfig = {
  id: "agent-1",
  tenantId: "tenant-1",
  name: "Test Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "You are a helpful agent.",
  tools: [],
};

const mockTask: Task = {
  id: "task-1",
  tenantId: "tenant-1",
  status: "in_progress",
  owner: "agent-1",
  parentId: null,
  description: "Test task: return hello world",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 100,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("AgentRunner", () => {
  test("completes task through full PAOR cycle", async () => {
    const { server, url } = createMockOrchServer();

    try {
      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Say hello"}]}',
        "Hello world!",
        '{"complete": true, "output": "Hello world!"}',
      ]);

      const runner = new AgentRunner({
        llmClient,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: url,
      });

      const result = await runner.executeTask(mockAgent, mockTask);
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.output).toBe("Hello world!");
      }
    } finally {
      server.stop();
    }
  });

  test("escalates when budget is exceeded", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ allowed: false, remaining: 0 });
      },
    });

    try {
      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Step 1"}]}',
      ]);

      const runner = new AgentRunner({
        llmClient,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: `http://localhost:${server.port}`,
      });

      const result = await runner.executeTask(mockAgent, mockTask);
      expect(result.status).toBe("escalated");
      if (result.status === "escalated") {
        expect(result.reason).toContain("budget");
      }
    } finally {
      server.stop();
    }
  });

  test("escalates after max attempts with no completion", async () => {
    const { server, url } = createMockOrchServer();

    try {
      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Try something"}]}',
        "Attempted but not sure",
        '{"complete": false, "escalate": false}',
      ]);

      const task = { ...mockTask, maxAttempts: 1 };
      const runner = new AgentRunner({
        llmClient,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: url,
      });

      const result = await runner.executeTask(mockAgent, task);
      expect(result.status).toBe("escalated");
      if (result.status === "escalated") {
        expect(result.reason).toContain("Max attempts");
      }
    } finally {
      server.stop();
    }
  });

  test("executes tool calls from plan steps", async () => {
    const { server, url } = createMockOrchServer();

    try {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register(
        { name: "echo", description: "Echo", parameters: {} },
        async (args) => `echoed: ${args.msg}`,
      );

      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Echo message", "tool": "echo", "args": {"msg": "hi"}}]}',
        '{"complete": true, "output": "echoed: hi"}',
      ]);

      const runner = new AgentRunner({
        llmClient,
        toolRegistry,
        orchBaseUrl: url,
      });

      const result = await runner.executeTask(mockAgent, mockTask);
      expect(result.status).toBe("completed");
    } finally {
      server.stop();
    }
  });

  test("cancellation stops execution", async () => {
    const { server, url } = createMockOrchServer();

    try {
      let callCount = 0;
      const slowLlm: LlmClient = {
        async chat(_req: LlmRequest): Promise<LlmResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              message: { role: "assistant", content: '{"steps": [{"description": "step 1"}, {"description": "step 2"}, {"description": "step 3"}]}' },
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              model: "mock",
              finishReason: "stop",
            };
          }
          await Bun.sleep(100);
          return {
            message: { role: "assistant", content: "result" },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        },
        async *stream() { yield { delta: "" }; },
        async countTokens() { return 10; },
      };

      const runner = new AgentRunner({
        llmClient: slowLlm,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: url,
      });

      const promise = runner.executeTask(mockAgent, mockTask);
      await Bun.sleep(50);
      runner.cancel(mockTask.id);

      const result = await promise;
      expect(result.status).toBe("escalated");
      if (result.status === "escalated") {
        expect(result.reason).toContain("cancelled");
      }
    } finally {
      server.stop();
    }
  });

  test("reflection disabled skips reflect phase", async () => {
    const { server, url } = createMockOrchServer();

    try {
      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Do something"}]}',
        "Done",
      ]);

      const runner = new AgentRunner({
        llmClient,
        toolRegistry: new ToolRegistry(),
        orchBaseUrl: url,
        reflectionEnabled: false,
      });

      const result = await runner.executeTask(mockAgent, mockTask);
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.output).toBe("Task steps executed");
      }
    } finally {
      server.stop();
    }
  });

  test("ask_user step short-circuits to needs_input instead of executing a tool call", async () => {
    const { server, url } = createMockOrchServer();

    try {
      const { askUserDefinition, askUserHandler } = await import("../tools/built-in/ask_user.ts");
      const toolRegistry = new ToolRegistry();
      toolRegistry.register(askUserDefinition, askUserHandler);

      const llmClient = createMockLlmClient([
        '{"steps": [{"description": "Ask which environment to deploy to", "tool": "ask_user", "args": {"question": "Which environment should I deploy to?"}}]}',
      ]);

      const runner = new AgentRunner({
        llmClient,
        toolRegistry,
        orchBaseUrl: url,
      });

      const result = await runner.executeTask(mockAgent, mockTask);
      expect(result.status).toBe("needs_input");
      if (result.status === "needs_input") {
        expect(result.question).toBe("Which environment should I deploy to?");
      }
    } finally {
      server.stop();
    }
  });
});
