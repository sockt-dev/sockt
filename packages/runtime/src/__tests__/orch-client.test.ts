import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { HttpOrchClient } from "../orch-client/client.ts";
import { SocktError } from "@sockt/types";

describe("HttpOrchClient", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let lastRequest: { method: string; path: string; body: any } | null;
  let responseOverride: { status?: number; body?: any } | null;

  beforeAll(() => {
    responseOverride = null;
    lastRequest = null;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = req.method !== "GET" ? await req.json().catch(() => null) : null;
        lastRequest = { method: req.method, path: url.pathname + url.search, body };

        if (responseOverride) {
          return Response.json(responseOverride.body ?? {}, { status: responseOverride.status ?? 200 });
        }

        if (url.pathname.endsWith("/claim")) {
          return Response.json({ id: "task-1", tenantId: "t1", status: "in_progress", owner: body?.agentId, parentId: null, description: "test", output: null, llmCallsUsed: 0, llmCallsBudget: 100, attemptCount: 0, maxAttempts: 3, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" });
        }
        if (url.pathname.endsWith("/complete")) {
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/escalate")) {
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/record-llm-call")) {
          return Response.json({ allowed: true, remaining: 99 });
        }
        if (url.pathname === "/tasks" && req.method === "GET") {
          return Response.json([]);
        }
        if (url.pathname === "/tasks" && req.method === "POST") {
          return Response.json({ id: "task-new", tenantId: body?.tenantId, status: "pending", owner: null, parentId: null, description: body?.description, output: null, llmCallsUsed: 0, llmCallsBudget: body?.llmCallsBudget ?? 100, attemptCount: 0, maxAttempts: body?.maxAttempts ?? 3, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" });
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("claim sends POST to /tasks/:id/claim", async () => {
    const client = new HttpOrchClient({ baseUrl });
    const task = await client.claim("task-1", "agent-1");

    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.path).toBe("/tasks/task-1/claim");
    expect(lastRequest!.body.agentId).toBe("agent-1");
    expect(task.id).toBe("task-1");
    expect(task.owner).toBe("agent-1");
  });

  test("complete sends POST to /tasks/:id/complete", async () => {
    const client = new HttpOrchClient({ baseUrl });
    await client.complete("task-1", "done");

    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.path).toBe("/tasks/task-1/complete");
    expect(lastRequest!.body.output).toBe("done");
  });

  test("escalate sends POST to /tasks/:id/escalate", async () => {
    const client = new HttpOrchClient({ baseUrl });
    await client.escalate("task-1", "too complex");

    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.path).toBe("/tasks/task-1/escalate");
    expect(lastRequest!.body.reason).toBe("too complex");
  });

  test("recordLlmCall returns budget info", async () => {
    const client = new HttpOrchClient({ baseUrl });
    const result = await client.recordLlmCall("task-1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  test("listPending sends GET with query params", async () => {
    const client = new HttpOrchClient({ baseUrl });
    const tasks = await client.listPending("tenant-1");

    expect(lastRequest!.method).toBe("GET");
    expect(lastRequest!.path).toBe("/tasks?tenantId=tenant-1&status=pending");
    expect(tasks).toEqual([]);
  });

  test("createTask sends POST to /tasks", async () => {
    const client = new HttpOrchClient({ baseUrl });
    const task = await client.createTask({ tenantId: "t1", description: "new task", llmCallsBudget: 50, maxAttempts: 2 } as any);

    expect(lastRequest!.method).toBe("POST");
    expect(lastRequest!.path).toBe("/tasks");
    expect(task.id).toBe("task-new");
    expect(task.description).toBe("new task");
  });

  test("throws SocktError on 404", async () => {
    responseOverride = { status: 404, body: { error: "not found" } };
    const client = new HttpOrchClient({ baseUrl, retries: 0 });

    try {
      await client.claim("nonexistent", "agent-1");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(SocktError);
      expect((error as SocktError).message).toContain("404");
    } finally {
      responseOverride = null;
    }
  });

  test("retries on 500", async () => {
    let callCount = 0;
    const retryServer = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        if (callCount < 3) {
          return Response.json({ error: "internal" }, { status: 500 });
        }
        return Response.json({ allowed: true, remaining: 50 });
      },
    });

    try {
      const client = new HttpOrchClient({ baseUrl: `http://localhost:${retryServer.port}`, retries: 2 });
      const result = await client.recordLlmCall("task-1");
      expect(result.allowed).toBe(true);
      expect(callCount).toBe(3);
    } finally {
      retryServer.stop();
    }
  });
});
