import { Hono } from "hono";
import type { ApprovalStore } from "../approval-store.ts";

export function approvalRoutes(approvalStore: ApprovalStore): Hono {
  const app = new Hono();

  app.post("/approvals", async (c) => {
    const body = await c.req.json();
    const approval = approvalStore.create(body);
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
