import { test, expect, describe, beforeEach } from "bun:test";
import { AgentRegistry } from "../registry/agent-registry.ts";
import type { AgentConfig } from "@sockt/types";

const makeAgent = (id: string, overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  tenantId: "tenant-1",
  name: `Agent ${id}`,
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "test",
  tools: [],
  ...overrides,
});

describe("AgentRegistry — stress & edge cases", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  test("handles 10000 registered agents", () => {
    for (let i = 0; i < 10000; i++) {
      registry.register(makeAgent(`agent-${i}`, { tenantId: `tenant-${i % 100}`, department: `dept-${i % 10}` }));
    }
    expect(registry.listAll()).toHaveLength(10000);
    expect(registry.listByTenant("tenant-0")).toHaveLength(100);
    expect(registry.listByDepartment("dept-5")).toHaveLength(1000);
  });

  test("getByName with special characters", () => {
    registry.register(makeAgent("special", { name: "Agent @#$%^&*()" }));
    expect(registry.getByName("Agent @#$%^&*()")).toBeDefined();
    expect(registry.getByName("agent @#$%^&*()")).toBeDefined();
  });

  test("getByName with unicode characters", () => {
    registry.register(makeAgent("unicode", { name: "Ägent Ünïcödé 日本語" }));
    expect(registry.getByName("ägent ünïcödé 日本語")).toBeDefined();
  });

  test("register then unregister all agents leaves registry empty", () => {
    for (let i = 0; i < 100; i++) {
      registry.register(makeAgent(`agent-${i}`));
    }
    for (let i = 0; i < 100; i++) {
      registry.unregister(`agent-${i}`);
    }
    expect(registry.listAll()).toHaveLength(0);
  });

  test("overwriting agent updates all lookup methods", () => {
    registry.register(makeAgent("a1", { name: "Old Name", department: "old-dept", tenantId: "t1" }));
    registry.register(makeAgent("a1", { name: "New Name", department: "new-dept", tenantId: "t2" }));

    expect(registry.getByName("Old Name")).toBeUndefined();
    expect(registry.getByName("New Name")).toBeDefined();
    expect(registry.listByDepartment("old-dept")).toHaveLength(0);
    expect(registry.listByDepartment("new-dept")).toHaveLength(1);
    expect(registry.listByTenant("t1")).toHaveLength(0);
    expect(registry.listByTenant("t2")).toHaveLength(1);
  });

  test("listByDepartment with undefined department returns nothing", () => {
    registry.register(makeAgent("a1"));
    expect(registry.listByDepartment("undefined")).toHaveLength(0);
  });

  test("agent with no department is not returned by listByDepartment", () => {
    registry.register(makeAgent("a1", { department: undefined }));
    expect(registry.listByDepartment("")).toHaveLength(0);
    expect(registry.listByDepartment("undefined")).toHaveLength(0);
  });

  test("duplicate name different ids: getByName returns first registered", () => {
    registry.register(makeAgent("a1", { name: "Same Name" }));
    registry.register(makeAgent("a2", { name: "Same Name" }));
    const found = registry.getByName("Same Name");
    expect(found?.id).toBe("a1");
  });

  test("concurrent-style rapid register/unregister", () => {
    for (let i = 0; i < 1000; i++) {
      registry.register(makeAgent(`agent-${i}`));
      if (i % 2 === 0) registry.unregister(`agent-${i}`);
    }
    expect(registry.listAll()).toHaveLength(500);
  });
});
