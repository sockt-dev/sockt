import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import { Orchestrator } from "../orchestrator.ts";
import type { OrchestratorConfig } from "../orchestrator.ts";
import type { ChannelGateway, TelemetryEmitter, InboundMessage, AgentConfig } from "@sockt/types";

function createMockChannelGateway(): ChannelGateway & { _handler: ((msg: InboundMessage) => Promise<void>) | null } {
  const gw: ChannelGateway & { _handler: ((msg: InboundMessage) => Promise<void>) | null } = {
    _handler: null,
    send: async () => "msg-id",
    onMessage: (handler) => { gw._handler = handler; },
    listChannels: async () => [],
    disconnect: async () => {},
  };
  return gw;
}

function createMockTelemetry(): TelemetryEmitter & { _events: unknown[] } {
  const events: unknown[] = [];
  return {
    _events: events,
    emit: (event) => { events.push(event); },
    flush: async () => {},
  };
}

const testAgent: AgentConfig = {
  id: "test-agent",
  tenantId: "t1",
  name: "Test Agent",
  role: "architect",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "test",
  tools: [],
};

describe("Orchestrator", () => {
  let orch: Orchestrator;
  let config: OrchestratorConfig;
  let gateway: ReturnType<typeof createMockChannelGateway>;
  let telemetry: ReturnType<typeof createMockTelemetry>;

  beforeEach(() => {
    const db = createTestDb();
    gateway = createMockChannelGateway();
    telemetry = createMockTelemetry();
    config = {
      port: 0,
      dbPath: ":memory:",
      db,
      agents: [testAgent],
      channelGateway: gateway,
      telemetry,
    };
    orch = new Orchestrator(config);
  });

  afterEach(async () => {
    await orch.stop();
  });

  test("start launches HTTP server accessible via health endpoint", async () => {
    await orch.start();
    const port = orch.getPort();
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  test("stop closes the HTTP server", async () => {
    await orch.start();
    const port = orch.getPort();
    await orch.stop();
    try {
      await fetch(`http://localhost:${port}/health`);
      expect(true).toBe(false);
    } catch {
      expect(true).toBe(true);
    }
  });

  test("handleMessage routes to correct agent and creates task", async () => {
    await orch.start();
    await orch.handleMessage({
      id: "msg-1",
      platform: "slack",
      channelId: "C123",
      userId: "U456",
      content: "plan Q3 campaign",
      mentions: ["Test Agent"],
      attachments: [],
      timestamp: "2024-01-01T00:00:00Z",
      tenantId: "t1",
    });

    const port = orch.getPort();
    const res = await fetch(`http://localhost:${port}/tasks/pending?tenantId=t1`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toContain("plan Q3 campaign");
  });

  test("handleMessage with no matching route creates no task", async () => {
    await orch.start();
    await orch.handleMessage({
      id: "msg-2",
      platform: "slack",
      channelId: "C123",
      userId: "U456",
      content: "random message",
      mentions: ["Unknown Agent"],
      attachments: [],
      timestamp: "2024-01-01T00:00:00Z",
      tenantId: "t1",
    });

    const port = orch.getPort();
    const res = await fetch(`http://localhost:${port}/tasks/pending?tenantId=t1`);
    const tasks = await res.json();
    expect(tasks).toHaveLength(0);
  });

  test("dispatch creates task for specified agent", async () => {
    await orch.start();
    const task = await orch.dispatch("test-agent", {
      tenantId: "t1",
      description: "Manual dispatch test",
    });
    expect(task.status).toBe("pending");
    expect(task.description).toBe("Manual dispatch test");
  });

  test("health returns correct status", async () => {
    await orch.start();
    const health = orch.health();
    expect(health.status).toBe("healthy");
    expect(health.activeAgents).toBe(0);
    expect(typeof health.uptime).toBe("number");
  });

  test("telemetry.emit called on task creation via dispatch", async () => {
    await orch.start();
    await orch.dispatch("test-agent", { tenantId: "t1", description: "Telemetry test" });
    expect(telemetry._events.length).toBeGreaterThan(0);
    const event = telemetry._events[0] as { type: string };
    expect(event.type).toBe("task_created");
  });

  describe("clarifying-question resume via threaded reply", () => {
    test("a threaded reply matching a pending question answers it and resumes the task", async () => {
      await orch.start();
      const port = orch.getPort();

      // Create the top-level task (also persists its Slack origin).
      await orch.handleMessage({
        id: "msg-1",
        platform: "slack",
        channelId: "C123",
        threadId: "T1",
        userId: "U456",
        content: "plan Q3 campaign",
        mentions: ["Test Agent"],
        attachments: [],
        timestamp: "2024-01-01T00:00:00Z",
        tenantId: "t1",
      });
      const pendingRes = await fetch(`http://localhost:${port}/tasks/pending?tenantId=t1`);
      const [task] = await pendingRes.json();

      await fetch(`http://localhost:${port}/tasks/${task.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1" }),
      });
      await fetch(`http://localhost:${port}/tasks/${task.id}/request-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Which environment?", agentId: "agent-1" }),
      });

      const blockedRes = await fetch(`http://localhost:${port}/tasks/${task.id}`);
      const blocked = await blockedRes.json();
      expect(blocked.status).toBe("blocked");

      // The reply: same channel + thread as the origin, no mention — proves
      // this is matched via the pending question, not normal routing (which
      // would find no agent and create nothing).
      await orch.handleMessage({
        id: "msg-2",
        platform: "slack",
        channelId: "C123",
        threadId: "T1",
        userId: "U456",
        content: "staging, please",
        mentions: [],
        attachments: [],
        timestamp: "2024-01-01T00:01:00Z",
        tenantId: "t1",
      });

      const resumedRes = await fetch(`http://localhost:${port}/tasks/${task.id}`);
      const resumed = await resumedRes.json();
      expect(resumed.status).toBe("pending");
      expect(resumed.owner).toBeNull();
      expect(resumed.description).toContain("staging, please");

      // No new task was created for the reply itself.
      const allPendingRes = await fetch(`http://localhost:${port}/tasks/pending?tenantId=t1`);
      const allPending = await allPendingRes.json();
      expect(allPending).toHaveLength(1);
    });

    test("a threaded reply with no pending question is routed normally", async () => {
      await orch.start();
      const port = orch.getPort();

      await orch.handleMessage({
        id: "msg-3",
        platform: "slack",
        channelId: "C999",
        threadId: "T-unrelated",
        userId: "U456",
        content: "plan Q3 campaign",
        mentions: ["Test Agent"],
        attachments: [],
        timestamp: "2024-01-01T00:00:00Z",
        tenantId: "t1",
      });

      const res = await fetch(`http://localhost:${port}/tasks/pending?tenantId=t1`);
      const tasks = await res.json();
      expect(tasks).toHaveLength(1);
    });
  });
});
