import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import { Orchestrator } from "../orchestrator.ts";
import type { OrchestratorConfig } from "../orchestrator.ts";
import type { ChannelGateway, TelemetryEmitter, AgentConfig } from "@sockt/types";

const agents: AgentConfig[] = Array.from({ length: 10 }, (_, i) => ({
  id: `agent-${i}`,
  tenantId: `tenant-${i % 3}`,
  name: `Agent ${i}`,
  role: i % 3 === 0 ? "architect" as const : "worker" as const,
  llmConfig: { provider: "openai" as const, model: "gpt-4" },
  systemPrompt: "test",
  tools: [],
  department: `dept-${i % 2}`,
}));

describe("Orchestrator — stress & edge cases", () => {
  let orch: Orchestrator;
  let baseUrl: string;
  let telemetryEvents: unknown[];

  beforeEach(async () => {
    const db = createTestDb();
    telemetryEvents = [];
    const telemetry: TelemetryEmitter = {
      emit: (e) => { telemetryEvents.push(e); },
      flush: async () => {},
    };
    const config: OrchestratorConfig = {
      port: 0,
      dbPath: ":memory:",
      db,
      agents,
      telemetry,
    };
    orch = new Orchestrator(config);
    await orch.start();
    baseUrl = `http://localhost:${orch.getPort()}`;
  });

  afterEach(async () => {
    await orch.stop();
  });

  test("50 concurrent dispatches all create tasks", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        orch.dispatch(`agent-${i % 10}`, { tenantId: "tenant-0", description: `Task ${i}` })
      )
    );
    expect(results).toHaveLength(50);
    for (const r of results) {
      expect(r.status).toBe("pending");
    }

    const res = await fetch(`${baseUrl}/tasks/pending?tenantId=tenant-0`);
    const pending = await res.json();
    expect(pending).toHaveLength(50);
  });

  test("handleMessage to multiple agents creates task for each", async () => {
    await orch.handleMessage({
      id: "msg-multi",
      platform: "slack",
      channelId: "C999",
      userId: "U1",
      content: "multi-route test",
      mentions: ["Agent 0", "Agent 1", "Agent 2"],
      attachments: [],
      timestamp: "2024-01-01T00:00:00Z",
      tenantId: "tenant-0",
    });

    const res = await fetch(`${baseUrl}/tasks/pending?tenantId=tenant-0`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(3);
  });

  test("full lifecycle with multiple agents competing for tasks", async () => {
    // Create 10 tasks
    const taskIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-0", description: `Work ${i}`, role: "architect" }),
      });
      const task = await res.json();
      taskIds.push(task.id);
    }

    // Each task claimed by a different agent
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/tasks/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: taskIds[i], agentId: `agent-${i}` }),
      });
      expect(res.status).toBe(200);
    }

    // All complete
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/tasks/${taskIds[i]}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output: `Result ${i}`, agentId: `agent-${i}` }),
      });
      expect(res.status).toBe(200);
    }

    // No pending tasks left
    const pendingRes = await fetch(`${baseUrl}/tasks/pending?tenantId=tenant-0`);
    const pending = await pendingRes.json();
    expect(pending).toHaveLength(0);
  });

  test("health endpoint reflects active agents after claims", async () => {
    const task = await orch.dispatch("agent-0", { tenantId: "tenant-0", description: "Health check task" });
    await fetch(`${baseUrl}/tasks/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, agentId: "agent-0" }),
    });

    const health = orch.health();
    expect(health.activeAgents).toBe(1);
  });

  test("rapid start/stop cycles do not leak resources", async () => {
    await orch.stop();
    for (let i = 0; i < 5; i++) {
      const db = createTestDb();
      const o = new Orchestrator({ port: 0, dbPath: ":memory:", db, agents: [] });
      await o.start();
      expect(o.health().status).toBe("healthy");
      await o.stop();
    }
  });

  test("telemetry accumulates events for all operations", async () => {
    const task = await orch.dispatch("agent-0", { tenantId: "tenant-0", description: "Telem test" });
    await fetch(`${baseUrl}/tasks/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, agentId: "agent-0" }),
    });
    await fetch(`${baseUrl}/tasks/${task.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output: "done", agentId: "agent-0" }),
    });

    expect(telemetryEvents.length).toBeGreaterThanOrEqual(3);
  });

  test("departments config auto-registers agents", async () => {
    await orch.stop();

    const db = createTestDb();
    const deptOrch = new Orchestrator({
      port: 0,
      dbPath: ":memory:",
      db,
      agents: [],
      departments: [
        { name: "growth", tenantId: "t1", template: "growth" },
        { name: "support", tenantId: "t1", template: "support" },
      ],
    });
    await deptOrch.start();

    // Dispatch to a department agent
    const task = await deptOrch.dispatch("t1-growth-architect", {
      tenantId: "t1",
      description: "Department test",
    });
    expect(task.status).toBe("pending");
    await deptOrch.stop();
  });
});
