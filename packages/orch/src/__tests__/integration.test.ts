import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import { Orchestrator } from "../orchestrator.ts";
import type { OrchestratorConfig } from "../orchestrator.ts";
import type { AgentConfig } from "@sockt/types";

const testAgent: AgentConfig = {
  id: "test-agent",
  tenantId: "t1",
  name: "Test Agent",
  role: "architect",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "test",
  tools: [],
};

describe("Integration", () => {
  let orch: Orchestrator;
  let baseUrl: string;

  beforeEach(async () => {
    const db = createTestDb();
    const config: OrchestratorConfig = {
      port: 0,
      dbPath: ":memory:",
      db,
      agents: [testAgent],
    };
    orch = new Orchestrator(config);
    await orch.start();
    baseUrl = `http://localhost:${orch.getPort()}`;
  });

  afterEach(async () => {
    await orch.stop();
  });

  test("full lifecycle: create -> claim -> llm-call -> complete", async () => {
    // Create task
    const createRes = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t1", description: "Lifecycle test", role: "architect" }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json();

    // Claim task
    const claimRes = await fetch(`${baseUrl}/tasks/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, agentId: "test-agent" }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    expect(claimed.status).toBe("in_progress");

    // LLM call
    const llmRes = await fetch(`${baseUrl}/tasks/${task.id}/llm-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(llmRes.status).toBe(200);
    const llmBody = await llmRes.json();
    expect(llmBody.remaining).toBe(24);

    // Complete
    const completeRes = await fetch(`${baseUrl}/tasks/${task.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output: "All done", agentId: "test-agent" }),
    });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.status).toBe("completed");
    expect(completed.output).toBe("All done");
  });

  test("budget exhaustion triggers escalation", async () => {
    // Create task with budget of 2
    const createRes = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t1", description: "Budget test", role: "architect", llmCallsBudget: 2 }),
    });
    const task = await createRes.json();

    // Claim
    await fetch(`${baseUrl}/tasks/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, agentId: "test-agent" }),
    });

    // First LLM call - remaining 1
    const res1 = await fetch(`${baseUrl}/tasks/${task.id}/llm-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body1 = await res1.json();
    expect(body1.remaining).toBe(1);

    // Second LLM call - remaining 0, should auto-escalate
    const res2 = await fetch(`${baseUrl}/tasks/${task.id}/llm-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body2 = await res2.json();
    expect(body2.remaining).toBe(0);

    // Verify task is escalated
    const pendingRes = await fetch(`${baseUrl}/tasks/pending?tenantId=t1`);
    const pending = await pendingRes.json();
    const escalatedTask = pending.find((t: any) => t.id === task.id);
    expect(escalatedTask).toBeUndefined(); // no longer pending
  });

  test("concurrent claim race: only one agent wins", async () => {
    // Create task
    const createRes = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "t1", description: "Race test", role: "architect" }),
    });
    const task = await createRes.json();

    // Race 5 agents
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fetch(`${baseUrl}/tasks/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, agentId: `agent-${i}` }),
        })
      )
    );

    const successes = claims.filter((r) => r.status === 200);
    const conflicts = claims.filter((r) => r.status === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
  });

  test("message -> route -> dispatch -> task created in store", async () => {
    await orch.handleMessage({
      id: "msg-1",
      platform: "slack",
      channelId: "C123",
      userId: "U456",
      content: "build dashboard widget",
      mentions: ["Test Agent"],
      attachments: [],
      timestamp: "2024-01-01T00:00:00Z",
      tenantId: "t1",
    });

    const res = await fetch(`${baseUrl}/tasks/pending?tenantId=t1`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("build dashboard widget");
  });
});
