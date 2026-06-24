import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { AgentRunner } from "../../runner/agent-runner.ts";
import { ToolRegistry } from "../../tools/registry.ts";
import { SkillCompiler } from "../../skills/compiler.ts";
import { ExecutionTrace } from "../../trace/execution-trace.ts";
import type { LlmClient, LlmRequest, LlmResponse, LlmMessage, LlmStreamChunk, AgentConfig, Task, HitlGate, ApprovalRequest, ApprovalDecision } from "@sockt/types";
import { rmSync, mkdirSync } from "node:fs";

const skillsDir = "/tmp/sockt-integration-skills";

const agent: AgentConfig = {
  id: "integration-agent",
  tenantId: "tenant-int",
  name: "Integration Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "You are a task-executing agent.",
  tools: ["file-read", "file-write"],
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}`,
    tenantId: "tenant-int",
    status: "in_progress",
    owner: "integration-agent",
    parentId: null,
    description: "Integration test task",
    output: null,
    llmCallsUsed: 0,
    llmCallsBudget: 50,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function sequentialLlm(responses: string[]): LlmClient {
  let idx = 0;
  return {
    async chat(_req: LlmRequest): Promise<LlmResponse> {
      const content = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return {
        message: { role: "assistant", content },
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        model: "mock",
        finishReason: "stop",
      };
    },
    async *stream() { yield { delta: "chunk" }; },
    async countTokens() { return 100; },
  };
}

describe("Integration: Full PAOR Loop", () => {
  let orchServer: ReturnType<typeof Bun.serve>;
  let orchUrl: string;
  let budgetRemaining: number;
  let recordedCalls: number;

  beforeAll(() => {
    mkdirSync(skillsDir, { recursive: true });
    budgetRemaining = 50;
    recordedCalls = 0;

    orchServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/record-llm-call")) {
          recordedCalls++;
          budgetRemaining--;
          return Response.json({ allowed: budgetRemaining >= 0, remaining: Math.max(0, budgetRemaining) });
        }
        if (url.pathname.endsWith("/claim")) {
          const body = await req.json() as any;
          return Response.json({ id: "task-1", owner: body.agentId, status: "in_progress" });
        }
        if (url.pathname.endsWith("/complete") || url.pathname.endsWith("/escalate")) {
          return new Response(null, { status: 204 });
        }
        return Response.json({}, { status: 200 });
      },
    });
    orchUrl = `http://localhost:${orchServer.port}`;
  });

  afterAll(() => {
    orchServer.stop();
    rmSync(skillsDir, { recursive: true, force: true });
  });

  test("multi-step plan with tool calls completes successfully", async () => {
    budgetRemaining = 50;
    recordedCalls = 0;

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      { name: "file-read", description: "Read a file", parameters: { path: { type: "string" } } },
      async (args) => `Contents of ${args.path}: hello world`,
    );
    toolRegistry.register(
      { name: "file-write", description: "Write a file", parameters: { path: { type: "string" }, content: { type: "string" } } },
      async (args) => `Wrote ${(args.content as string).length} bytes to ${args.path}`,
    );

    const llm = sequentialLlm([
      '{"steps": [{"description": "Read config", "tool": "file-read", "args": {"path": "/etc/config.json"}}, {"description": "Write output", "tool": "file-write", "args": {"path": "/tmp/out.txt", "content": "processed"}}]}',
      '{"complete": true, "output": "Read config and wrote output successfully"}',
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry,
      orchBaseUrl: orchUrl,
      skillsDir,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output).toBe("Read config and wrote output successfully");
    }
    expect(recordedCalls).toBe(2);
  });

  test("skill files are written after successful execution", async () => {
    budgetRemaining = 50;

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      { name: "search", description: "Search", parameters: {} },
      async () => "found it",
    );

    const llm = sequentialLlm([
      '{"steps": [{"description": "Search for answer", "tool": "search", "args": {}}]}',
      '{"complete": true, "output": "Found the answer"}',
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry,
      orchBaseUrl: orchUrl,
      skillsDir,
    });

    await runner.executeTask(agent, makeTask({ id: "skill-test-task" }));

    const glob = new Bun.Glob("*.skill");
    const files: string[] = [];
    for await (const f of glob.scan(skillsDir)) files.push(f);
    expect(files.length).toBeGreaterThanOrEqual(1);

    const content = await Bun.file(`${skillsDir}/${files[0]}`).json();
    expect(content.steps.length).toBeGreaterThanOrEqual(1);
    expect(content.steps[0].tool).toBe("search");
  });

  test("budget exhaustion mid-execution escalates cleanly", async () => {
    budgetRemaining = 1;

    const toolRegistry = new ToolRegistry();
    const llm = sequentialLlm([
      '{"steps": [{"description": "Step 1"}, {"description": "Step 2"}, {"description": "Step 3"}]}',
      "Result 1",
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry,
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("escalated");
    if (result.status === "escalated") {
      expect(result.reason.toLowerCase()).toContain("budget");
    }
  });

  test("HITL denial blocks execution with correct dependency info", async () => {
    budgetRemaining = 50;

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      { name: "deploy", description: "Deploy to prod", parameters: {} },
      async () => "deployed",
    );
    toolRegistry.setApprovalRequired(["deploy"]);

    const hitlGate: HitlGate = {
      async requestApproval(_req: ApprovalRequest) { return "req-123"; },
      async checkApproval(_id: string) { return "denied"; },
      async waitForApproval(_id: string, _timeout: number): Promise<ApprovalDecision> {
        return { requestId: "req-123", status: "denied", decidedBy: "admin", decidedAt: "2024-01-01T00:00:00Z" };
      },
      async listPending() { return []; },
    };

    const llm = sequentialLlm([
      '{"steps": [{"description": "Deploy the app", "tool": "deploy", "args": {}}]}',
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry,
      orchBaseUrl: orchUrl,
      hitlGate,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.dependency).toContain("HITL denied");
      expect(result.dependency).toContain("deploy");
    }
  });

  test("reflection escalation works", async () => {
    budgetRemaining = 50;

    const llm = sequentialLlm([
      '{"steps": [{"description": "Attempt complex task"}]}',
      "I cannot figure this out",
      '{"complete": false, "escalate": true, "reason": "Task requires human expertise"}',
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry: new ToolRegistry(),
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("escalated");
    if (result.status === "escalated") {
      expect(result.reason).toBe("Task requires human expertise");
    }
  });

  test("malformed LLM plan response falls back to single step", async () => {
    budgetRemaining = 50;

    const llm = sequentialLlm([
      "I'll just do the task directly without JSON formatting.",
      "Here is the result of my work.",
      '{"complete": true, "output": "Done via fallback plan"}',
    ]);

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry: new ToolRegistry(),
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output).toBe("Done via fallback plan");
    }
  });

  test("malformed reflection response retries next attempt", async () => {
    budgetRemaining = 50;

    let planCallCount = 0;
    const llm: LlmClient = {
      async chat(req: LlmRequest): Promise<LlmResponse> {
        const lastMsg = req.messages[req.messages.length - 1]!.content;
        if (lastMsg.includes("step-by-step execution plan")) {
          planCallCount++;
          return {
            message: { role: "assistant", content: '{"steps": [{"description": "Do work"}]}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        if (lastMsg.includes("Reflect")) {
          if (planCallCount < 2) {
            return {
              message: { role: "assistant", content: "Not valid JSON reflection" },
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              model: "mock",
              finishReason: "stop",
            };
          }
          return {
            message: { role: "assistant", content: '{"complete": true, "output": "Finally done"}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        return {
          message: { role: "assistant", content: "Executed step" },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: "mock",
          finishReason: "stop",
        };
      },
      async *stream() { yield { delta: "" }; },
      async countTokens() { return 10; },
    };

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry: new ToolRegistry(),
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask({ maxAttempts: 3 }));
    expect(result.status).toBe("completed");
    expect(planCallCount).toBe(2);
  });

  test("tool execution failure is reported in observation", async () => {
    budgetRemaining = 50;

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      { name: "flaky", description: "Flaky tool", parameters: {} },
      async () => { throw new Error("connection timeout"); },
    );

    let reflectMessages: string[] = [];
    const llm: LlmClient = {
      async chat(req: LlmRequest): Promise<LlmResponse> {
        const lastMsg = req.messages[req.messages.length - 1]!.content;
        if (lastMsg.includes("step-by-step")) {
          return {
            message: { role: "assistant", content: '{"steps": [{"description": "Call flaky", "tool": "flaky", "args": {}}]}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        if (lastMsg.includes("Reflect")) {
          reflectMessages = req.messages.map((m) => m.content);
          return {
            message: { role: "assistant", content: '{"complete": true, "output": "Handled gracefully"}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        return {
          message: { role: "assistant", content: "ok" },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: "mock",
          finishReason: "stop",
        };
      },
      async *stream() { yield { delta: "" }; },
      async countTokens() { return 10; },
    };

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry,
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask());
    expect(result.status).toBe("completed");
    const hasObservation = reflectMessages.some((m) => m.includes("connection timeout"));
    expect(hasObservation).toBe(true);
  });

  test("multiple attempts loop correctly until success", async () => {
    budgetRemaining = 50;
    let attemptNum = 0;

    const llm: LlmClient = {
      async chat(req: LlmRequest): Promise<LlmResponse> {
        const lastMsg = req.messages[req.messages.length - 1]!.content;
        if (lastMsg.includes("step-by-step")) {
          attemptNum++;
          return {
            message: { role: "assistant", content: '{"steps": [{"description": "Try approach"}]}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        if (lastMsg.includes("Reflect")) {
          if (attemptNum < 3) {
            return {
              message: { role: "assistant", content: '{"complete": false}' },
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              model: "mock",
              finishReason: "stop",
            };
          }
          return {
            message: { role: "assistant", content: '{"complete": true, "output": "Succeeded on attempt 3"}' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock",
            finishReason: "stop",
          };
        }
        return {
          message: { role: "assistant", content: "intermediate" },
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: "mock",
          finishReason: "stop",
        };
      },
      async *stream() { yield { delta: "" }; },
      async countTokens() { return 10; },
    };

    const runner = new AgentRunner({
      llmClient: llm,
      toolRegistry: new ToolRegistry(),
      orchBaseUrl: orchUrl,
    });

    const result = await runner.executeTask(agent, makeTask({ maxAttempts: 5 }));
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output).toBe("Succeeded on attempt 3");
    }
    expect(attemptNum).toBe(3);
  });
});
