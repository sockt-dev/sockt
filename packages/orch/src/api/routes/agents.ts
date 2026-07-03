import { Hono } from "hono";
import type { AgentConfig } from "@sockt/types";
import type { AgentRegistry } from "../../registry/agent-registry.ts";

export function agentRoutes(registry: AgentRegistry): Hono {
  const app = new Hono();

  app.get("/agents", (c) => {
    const tenantId = c.req.query("tenantId");
    const agents = tenantId ? registry.listByTenant(tenantId) : registry.listAll();
    return c.json(agents);
  });

  app.get("/agents/:id", (c) => {
    const agent = registry.get(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  });

  app.post("/agents/register", async (c) => {
    const body = await c.req.json() as Omit<AgentConfig, "id"> & { id?: string };
    const id = body.id ?? crypto.randomUUID();
    const agent: AgentConfig = { ...body, id };
    registry.register(agent);
    return c.json(agent, 201);
  });

  app.delete("/agents/:id", (c) => {
    const id = c.req.param("id");
    const agent = registry.get(id);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    registry.unregister(id);
    return c.json({ ok: true });
  });

  return app;
}
