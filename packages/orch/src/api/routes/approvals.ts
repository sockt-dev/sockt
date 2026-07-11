import { Hono } from "hono";
import type { ApprovalStore, StoredApproval } from "../approval-store.ts";

export function approvalRoutes(approvalStore: ApprovalStore, onCreated?: (approval: StoredApproval) => void): Hono {
  const app = new Hono();

  app.get("/approvals/pending", (c) => {
    const tenantId = c.req.query("tenantId");
    if (!tenantId) return c.json({ error: "tenantId query parameter required" }, 400);
    return c.json(approvalStore.listPending(tenantId));
  });

  app.post("/approvals", async (c) => {
    const body = await c.req.json();
    const approval = approvalStore.create(body);
    onCreated?.(approval);
    return c.json(approval, 201);
  });

  app.get("/approvals/:id", (c) => {
    const id = c.req.param("id");
    const approval = approvalStore.get(id);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  app.post("/approvals/:id/decide", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const approval = approvalStore.decide(id, body);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  return app;
}
