import { test, expect, describe, beforeEach } from "bun:test";
import { DepartmentManager } from "../registry/department-manager.ts";
import { AgentRegistry } from "../registry/agent-registry.ts";
import type { DepartmentTemplate } from "../registry/department-manager.ts";

describe("DepartmentManager", () => {
  let registry: AgentRegistry;
  let manager: DepartmentManager;

  beforeEach(() => {
    registry = new AgentRegistry();
    manager = new DepartmentManager(registry);
  });

  test("createFromTemplate registers agents into registry", () => {
    const agents = manager.createFromTemplate("growth", "tenant-1");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(registry.get(agent.id)).toEqual(agent);
    }
  });

  test("created agents get the supplied tenantId", () => {
    const agents = manager.createFromTemplate("product", "my-tenant");
    for (const agent of agents) {
      expect(agent.tenantId).toBe("my-tenant");
    }
  });

  test("created agents are findable in the registry by department", () => {
    manager.createFromTemplate("growth", "t1");
    const found = registry.listByDepartment("growth");
    expect(found.length).toBeGreaterThan(0);
  });

  test("listTemplates returns available template names", () => {
    const templates = manager.listTemplates();
    expect(templates).toContain("growth");
    expect(templates).toContain("product");
    expect(templates).toContain("engops");
    expect(templates).toContain("support");
  });

  test("each template has at least one architect and one worker", () => {
    const templates: DepartmentTemplate[] = ["growth", "product", "engops", "support"];
    for (const template of templates) {
      const reg = new AgentRegistry();
      const mgr = new DepartmentManager(reg);
      const agents = mgr.createFromTemplate(template, "t1");
      const hasArchitect = agents.some((a) => a.role === "architect");
      const hasWorker = agents.some((a) => a.role === "worker");
      expect(hasArchitect).toBe(true);
      expect(hasWorker).toBe(true);
    }
  });

  test("different tenants get independent agent instances", () => {
    const agents1 = manager.createFromTemplate("growth", "t1");
    const agents2 = manager.createFromTemplate("growth", "t2");
    expect(agents1[0].id).not.toBe(agents2[0].id);
    expect(agents1[0].tenantId).toBe("t1");
    expect(agents2[0].tenantId).toBe("t2");
  });
});
