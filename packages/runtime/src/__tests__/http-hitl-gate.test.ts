import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { HttpHitlGate } from "../hitl/http-hitl-gate.ts";

describe("HttpHitlGate", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let approvals: Map<string, { id: string; status: string; decidedBy?: string; reason?: string; decidedAt?: string; tenantId: string; agentId: string; taskId: string; tier: string; action: string; description: string }>;
  let nextId: number;

  beforeAll(() => {
    approvals = new Map();
    nextId = 1;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/approvals" && req.method === "POST") {
          const body = await req.json();
          const id = `approval-${nextId++}`;
          const record = { id, status: "pending", ...body };
          approvals.set(id, record);
          return Response.json(record, { status: 201 });
        }

        if (url.pathname === "/approvals/pending" && req.method === "GET") {
          const tenantId = url.searchParams.get("tenantId");
          const rows = [...approvals.values()].filter((a) => a.status === "pending" && a.tenantId === tenantId);
          return Response.json(rows);
        }

        const idMatch = url.pathname.match(/^\/approvals\/([^/]+)$/);
        if (idMatch && req.method === "GET") {
          const approval = approvals.get(idMatch[1]);
          if (!approval) return Response.json({ error: "not found" }, { status: 404 });
          return Response.json(approval);
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("requestApproval creates a pending approval and returns its id", async () => {
    const gate = new HttpHitlGate({ baseUrl });
    const id = await gate.requestApproval({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-1",
      tier: "confirm",
      action: "exec_code",
      description: "Run a shell command",
    });
    expect(id).toBeDefined();
    expect(approvals.get(id)?.status).toBe("pending");
  });

  test("checkApproval reflects current status", async () => {
    const gate = new HttpHitlGate({ baseUrl });
    const id = await gate.requestApproval({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-2",
      tier: "confirm",
      action: "exec_code",
      description: "check",
    });
    expect(await gate.checkApproval(id)).toBe("pending");
    approvals.get(id)!.status = "approved";
    expect(await gate.checkApproval(id)).toBe("approved");
  });

  test("waitForApproval resolves once the approval is decided", async () => {
    const gate = new HttpHitlGate({ baseUrl, pollIntervalMs: 20 });
    const id = await gate.requestApproval({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-3",
      tier: "confirm",
      action: "exec_code",
      description: "wait",
    });

    setTimeout(() => {
      const record = approvals.get(id)!;
      record.status = "approved";
      record.decidedBy = "operator-1";
    }, 50);

    const decision = await gate.waitForApproval(id, 2000);
    expect(decision.status).toBe("approved");
    expect(decision.decidedBy).toBe("operator-1");
  });

  test("waitForApproval times out locally if still pending at the deadline", async () => {
    const gate = new HttpHitlGate({ baseUrl, pollIntervalMs: 20 });
    const id = await gate.requestApproval({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-4",
      tier: "confirm",
      action: "exec_code",
      description: "never decided",
    });

    const decision = await gate.waitForApproval(id, 60);
    expect(decision.status).toBe("timeout");
  });

  test("listPending returns only pending approvals for the given tenant", async () => {
    approvals.clear();
    const gate = new HttpHitlGate({ baseUrl });
    await gate.requestApproval({ tenantId: "t1", agentId: "a1", taskId: "t-a", tier: "confirm", action: "exec_code", description: "x" });
    await gate.requestApproval({ tenantId: "t2", agentId: "a2", taskId: "t-b", tier: "confirm", action: "exec_code", description: "y" });

    const pending = await gate.listPending("t1");
    expect(pending).toHaveLength(1);
    expect(pending[0].tenantId).toBe("t1");
  });
});
