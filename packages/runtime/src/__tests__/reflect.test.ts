import { test, expect, describe } from "bun:test";
import { reflectPhase } from "../runner/reflect.ts";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { LlmClient, LlmRequest, LlmResponse, AgentConfig, Task } from "@sockt/types";

const agent: AgentConfig = {
  id: "reflect-test-agent",
  tenantId: "tenant-reflect",
  name: "Reflect Test Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "You are a task-executing agent.",
  tools: [],
};

const task: Task = {
  id: "reflect-test-task",
  tenantId: "tenant-reflect",
  status: "in_progress",
  owner: "reflect-test-agent",
  parentId: null,
  description: "Reflect test task",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 25,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function llmThatReturns(content: string) {
  let allMessages = "";
  const client: LlmClient = {
    async chat(req: LlmRequest): Promise<LlmResponse> {
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
  return { client, capturedAllMessages: () => allMessages };
}

function makeContext(trace = new ExecutionTrace(task.id, agent.id)) {
  return {
    agent,
    task,
    messages: [{ role: "system" as const, content: "sys" }],
    trace,
    budgetRemaining: 10,
    signal: new AbortController().signal,
    matchedSkills: [],
    gateFeedback: [] as string[],
  };
}

describe("reflectPhase", () => {
  test("includes the full content of the final write_file deliverable, not the 120-char step summary", async () => {
    const trace = new ExecutionTrace(task.id, agent.id);
    const longContent = "A".repeat(500);
    trace.addStep({
      phase: "act",
      action: "save",
      toolCall: { id: "1", name: "write_file", arguments: { filename: "out.md", content: longContent } },
      output: { written: "out.md" },
      durationMs: 0,
      timestamp: "2026-01-01T00:00:00Z",
    });

    const { client, capturedAllMessages } = llmThatReturns('{"complete": true, "output": "done"}');
    await reflectPhase(makeContext(trace), client);

    expect(capturedAllMessages()).toContain(longContent);
  });

  test("falls back to the last act step's untruncated output when there's no write_file", async () => {
    const trace = new ExecutionTrace(task.id, agent.id);
    const longOutput = "B".repeat(300);
    trace.addStep({ phase: "act", action: "narrate", output: longOutput, durationMs: 0, timestamp: "2026-01-01T00:00:00Z" });

    const { client, capturedAllMessages } = llmThatReturns('{"complete": true, "output": "done"}');
    await reflectPhase(makeContext(trace), client);

    expect(capturedAllMessages()).toContain(longOutput);
  });

  test("surfaces ctx.gateFeedback so reflect doesn't immediately re-declare the same failed output complete", async () => {
    const { client, capturedAllMessages } = llmThatReturns('{"complete": false}');
    const ctx = makeContext();
    ctx.gateFeedback.push("Your previous attempt produced output that FAILED mechanical verification. Fix ALL of these before finishing:\n- No unfilled placeholder tokens: found [name].");

    await reflectPhase(ctx, client);

    expect(capturedAllMessages()).toContain("FAILED mechanical verification");
    expect(capturedAllMessages()).toContain("found [name]");
  });
});
