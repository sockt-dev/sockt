import { test, expect, describe } from "bun:test";
import { SchemaValidator } from "../schema-validator.ts";

function validEventJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "memory_write",
    tenantId: "tenant-1",
    agentId: "agent-monitor",
    entry: {
      id: "entry-1",
      tenantId: "tenant-1",
      category: "fact",
      content: "The deployment succeeded at 14:00 UTC",
      source: "agent:monitor",
      createdAt: "2024-06-01T14:00:00Z",
    },
    timestamp: "2024-06-01T14:00:01Z",
    ...overrides,
  });
}

describe("SchemaValidator", () => {
  const validator = new SchemaValidator();

  test("valid event passes validation", () => {
    const result = validator.validate(validEventJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("memory_write");
      expect(result.event.tenantId).toBe("tenant-1");
      expect(result.event.agentId).toBe("agent-monitor");
      expect(result.event.entry.content).toBe("The deployment succeeded at 14:00 UTC");
    }
  });

  test("invalid JSON returns error with raw string", () => {
    const result = validator.validate("not{valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
      expect(result.raw).toBe("not{valid json");
    }
  });

  test("missing type field returns error", () => {
    const json = JSON.stringify({
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(false);
  });

  test("missing tenantId field returns error", () => {
    const json = JSON.stringify({
      type: "memory_write",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(false);
  });

  test("invalid event type value fails", () => {
    const result = validator.validate(validEventJson({ type: "invalid_type" }));
    expect(result.ok).toBe(false);
  });

  test("invalid timestamp format fails", () => {
    const result = validator.validate(validEventJson({ timestamp: "not-a-date" }));
    expect(result.ok).toBe(false);
  });

  test("invalid memory category fails", () => {
    const json = JSON.stringify({
      type: "memory_write",
      tenantId: "t1",
      agentId: "a1",
      entry: { id: "e1", tenantId: "t1", category: "invalid_category", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      timestamp: "2024-01-01T00:00:00Z",
    });
    const result = validator.validate(json);
    expect(result.ok).toBe(false);
  });

  test("all CadvpEventType values accepted", () => {
    for (const type of ["memory_write", "memory_update", "memory_delete", "sync"]) {
      const result = validator.validate(validEventJson({ type }));
      expect(result.ok).toBe(true);
    }
  });

  test("optional traceId accepted when present", () => {
    const result = validator.validate(validEventJson({ traceId: "trace-abc-123" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.traceId).toBe("trace-abc-123");
    }
  });

  test("optional traceId absent is fine", () => {
    const result = validator.validate(validEventJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.traceId).toBeUndefined();
    }
  });

  test("missing entry.id is auto-filled", () => {
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
      expect(result.event.entry.id).toBeDefined();
      expect(result.event.entry.id.length).toBeGreaterThan(0);
    }
  });

  test("missing entry.createdAt is auto-filled", () => {
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
      expect(result.event.entry.createdAt).toBeDefined();
      // Should be a valid ISO datetime
      expect(() => new Date(result.event.entry.createdAt)).not.toThrow();
    }
  });

  test("existing entry.id is preserved", () => {
    const result = validator.validate(validEventJson());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.entry.id).toBe("entry-1");
    }
  });
});
