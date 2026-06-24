import { test, expect, describe } from "bun:test";
import { SchemaValidator } from "../schema-validator.ts";

describe("SchemaValidator edge cases", () => {
  const validator = new SchemaValidator();

  test("empty string returns invalid JSON error", () => {
    const result = validator.validate("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid JSON");
  });

  test("whitespace-only string returns invalid JSON error", () => {
    const result = validator.validate("   \t\n  ");
    expect(result.ok).toBe(false);
  });

  test("null JSON value returns error", () => {
    const result = validator.validate("null");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Not an object");
  });

  test("JSON array returns error", () => {
    const result = validator.validate("[1,2,3]");
    expect(result.ok).toBe(false);
  });

  test("JSON number returns error", () => {
    const result = validator.validate("42");
    expect(result.ok).toBe(false);
  });

  test("JSON string returns error", () => {
    const result = validator.validate('"hello"');
    expect(result.ok).toBe(false);
  });

  test("very large content field is accepted", () => {
    const largeContent = "x".repeat(100_000);
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: largeContent, source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.entry.content.length).toBe(100_000);
  });

  test("unicode content is preserved", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "日本語テスト 🎉 émoji", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.entry.content).toBe("日本語テスト 🎉 émoji");
  });

  test("entry with metadata object is accepted", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: {
        id: "e1",
        tenantId: "t1",
        category: "decision",
        content: "chose option A",
        source: "agent:researcher",
        metadata: { confidence: 0.95, tags: ["important", "reviewed"] },
        createdAt: "2024-01-01T00:00:00Z",
      },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.entry.metadata).toEqual({ confidence: 0.95, tags: ["important", "reviewed"] });
    }
  });

  test("entry with embedding array is accepted", () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: {
        id: "e1",
        tenantId: "t1",
        category: "fact",
        content: "test",
        source: "s",
        embedding,
        createdAt: "2024-01-01T00:00:00Z",
      },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.entry.embedding).toHaveLength(1536);
  });

  test("all valid categories accepted", () => {
    for (const category of ["fact", "decision", "preference", "procedure", "context"]) {
      const json = JSON.stringify({
        type: "memory_write",
        tenantId: "t1",
        agentId: "a1",
        entry: { id: "e1", tenantId: "t1", category, content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
        timestamp: "2024-01-01T00:00:00Z",
      });
      const result = validator.validate(json);
      expect(result.ok).toBe(true);
    }
  });

  test("empty strings for required fields fail", () => {
    const json = JSON.stringify({
      type: "",
      tenantId: "",
      agentId: "",
      entry: { id: "", tenantId: "", category: "", content: "", source: "", createdAt: "" },
      timestamp: "",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(false);
  });

  test("entry.tenantId mismatch with event.tenantId is still valid (no cross-check)", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "tenant-A",
      agentId: "a1",
      entry: { id: "e1", tenantId: "tenant-B", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    // Schema doesn't enforce cross-field consistency — that's application logic
    expect(result.ok).toBe(true);
  });

  test("timestamp with timezone offset is rejected (Zod requires UTC Z suffix)", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00+05:30" },
      timestamp: "2024-01-01T00:00:00+05:30",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(false);
  });

  test("timestamp with Z suffix is accepted", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
  });

  test("multiple validation calls are independent (no shared state)", () => {
    const valid = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });

    // Alternate valid and invalid
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        expect(validator.validate(valid).ok).toBe(true);
      } else {
        expect(validator.validate("garbage").ok).toBe(false);
      }
    }
  });

  test("deeply nested metadata is accepted", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: {
        id: "e1",
        tenantId: "t1",
        category: "fact",
        content: "test",
        source: "s",
        metadata: { a: { b: { c: { d: { e: "deep" } } } } },
        createdAt: "2024-01-01T00:00:00Z",
      },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
  });

  test("normalized entry.id is a valid UUID format", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { tenantId: "t1", category: "fact", content: "x", source: "s" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  test("each call generates a unique id when missing", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { tenantId: "t1", category: "fact", content: "x", source: "s" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = validator.validate(json);
      if (result.ok) ids.add(result.event.entry.id);
    }
    expect(ids.size).toBe(100);
  });
});
