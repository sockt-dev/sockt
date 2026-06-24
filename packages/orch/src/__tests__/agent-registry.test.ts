import { test, expect, describe, beforeEach } from "bun:test";
import { AgentRegistry } from "../registry/agent-registry.ts";
import type { AgentConfig } from "@sockt/types";

const makeAgent = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "agent-1",
  tenantId: "tenant-1",
  name: "Test Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "You are a test agent.",
  tools: [],
  ...overrides,
});

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  test("register adds an agent retrievable by id", () => {
    const agent = makeAgent({ id: "a1" });
    registry.register(agent);
    expect(registry.get("a1")).toEqual(agent);
  });

  test("register overwrites existing agent with same id", () => {
    registry.register(makeAgent({ id: "a1", name: "First" }));
    registry.register(makeAgent({ id: "a1", name: "Second" }));
    expect(registry.get("a1")?.name).toBe("Second");
  });

  test("unregister removes agent by id", () => {
    registry.register(makeAgent({ id: "a1" }));
    registry.unregister("a1");
    expect(registry.get("a1")).toBeUndefined();
  });

  test("unregister is a no-op for unknown id", () => {
    expect(() => registry.unregister("unknown")).not.toThrow();
  });

  test("get returns undefined for unknown agent", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("getByName returns agent matching name field", () => {
    const agent = makeAgent({ id: "a1", name: "Growth Architect" });
    registry.register(agent);
    expect(registry.getByName("Growth Architect")).toEqual(agent);
  });

  test("getByName is case-insensitive", () => {
    const agent = makeAgent({ id: "a1", name: "Growth Architect" });
    registry.register(agent);
    expect(registry.getByName("growth architect")).toEqual(agent);
    expect(registry.getByName("GROWTH ARCHITECT")).toEqual(agent);
  });

  test("listByDepartment returns agents in that department", () => {
    registry.register(makeAgent({ id: "a1", department: "growth" }));
    registry.register(makeAgent({ id: "a2", department: "growth" }));
    registry.register(makeAgent({ id: "a3", department: "product" }));
    expect(registry.listByDepartment("growth")).toHaveLength(2);
  });

  test("listByDepartment returns empty array for unknown department", () => {
    expect(registry.listByDepartment("nonexistent")).toEqual([]);
  });

  test("listByTenant returns agents matching tenantId", () => {
    registry.register(makeAgent({ id: "a1", tenantId: "t1" }));
    registry.register(makeAgent({ id: "a2", tenantId: "t2" }));
    registry.register(makeAgent({ id: "a3", tenantId: "t1" }));
    expect(registry.listByTenant("t1")).toHaveLength(2);
  });

  test("listAll returns all registered agents", () => {
    registry.register(makeAgent({ id: "a1" }));
    registry.register(makeAgent({ id: "a2" }));
    expect(registry.listAll()).toHaveLength(2);
  });

  test("constructor with initial agents registers them all", () => {
    const agents = [
      makeAgent({ id: "a1" }),
      makeAgent({ id: "a2" }),
      makeAgent({ id: "a3" }),
    ];
    const reg = new AgentRegistry(agents);
    expect(reg.listAll()).toHaveLength(3);
    expect(reg.get("a2")).toEqual(agents[1]);
  });
});
