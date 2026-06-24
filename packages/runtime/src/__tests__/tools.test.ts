import { test, expect, describe } from "bun:test";
import { ToolRegistry } from "../tools/registry.ts";

describe("ToolRegistry", () => {
  test("register and retrieve definitions", () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "search", description: "Search the web", parameters: { query: { type: "string" } } },
      async (args) => `results for ${args.query}`,
    );

    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe("search");
    expect(defs[0]!.description).toBe("Search the web");
  });

  test("execute valid tool call returns success", async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "echo", description: "Echo input", parameters: {} },
      async (args) => `echo: ${args.message}`,
    );

    const result = await registry.execute({ id: "call-1", name: "echo", arguments: { message: "hello" } });
    expect(result.success).toBe(true);
    expect(result.output).toBe("echo: hello");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("execute unknown tool returns error result", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute({ id: "call-1", name: "unknown", arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  test("execute catches handler errors", async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "fail", description: "Always fails", parameters: {} },
      async () => { throw new Error("intentional failure"); },
    );

    const result = await registry.execute({ id: "call-1", name: "fail", arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe("intentional failure");
  });

  test("requiresApproval checks approval set", () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "deploy", description: "Deploy", parameters: {} },
      async () => "deployed",
    );
    registry.register(
      { name: "read", description: "Read", parameters: {} },
      async () => "data",
    );

    registry.setApprovalRequired(["deploy"]);
    expect(registry.requiresApproval("deploy")).toBe(true);
    expect(registry.requiresApproval("read")).toBe(false);
    expect(registry.requiresApproval("nonexistent")).toBe(false);
  });

  test("has checks tool existence", () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: "test", description: "Test", parameters: {} },
      async () => null,
    );

    expect(registry.has("test")).toBe(true);
    expect(registry.has("missing")).toBe(false);
  });
});
