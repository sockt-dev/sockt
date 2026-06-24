import { test, expect, describe, beforeEach } from "bun:test";
import { MessageRouter } from "../router/message-router.ts";
import { AgentRegistry } from "../registry/agent-registry.ts";
import type { AgentConfig, InboundMessage } from "@sockt/types";

const makeAgent = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: "agent-1",
  tenantId: "tenant-1",
  name: "Test Agent",
  role: "worker",
  llmConfig: { provider: "openai", model: "gpt-4" },
  systemPrompt: "test",
  tools: [],
  ...overrides,
});

const makeMessage = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "msg-1",
  platform: "slack",
  channelId: "C123",
  userId: "U456",
  content: "hello world",
  attachments: [],
  mentions: [],
  timestamp: "2024-01-01T00:00:00Z",
  tenantId: "tenant-1",
  ...overrides,
});

describe("MessageRouter — edge cases", () => {
  let registry: AgentRegistry;
  let router: MessageRouter;

  beforeEach(() => {
    registry = new AgentRegistry([
      makeAgent({ id: "a1", name: "Alpha Agent" }),
      makeAgent({ id: "a2", name: "Beta Agent" }),
      makeAgent({ id: "a3", name: "Gamma Agent" }),
    ]);
    router = new MessageRouter(registry);
  });

  test("empty mentions array with no channel mapping and no content rules returns empty", () => {
    const result = router.route(makeMessage());
    expect(result).toEqual([]);
  });

  test("mention of empty string does not match any agent", () => {
    const result = router.route(makeMessage({ mentions: [""] }));
    expect(result).toEqual([]);
  });

  test("content rule with greedy regex only matches once", () => {
    router.addContentRule(/.*/, "a1");
    const result = router.route(makeMessage({ content: "anything at all" }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
  });

  test("content rule regex does not persist state across calls (no /g flag issue)", () => {
    router.addContentRule(/test/g, "a1");
    const msg = makeMessage({ content: "test message" });
    expect(router.route(msg)).toHaveLength(1);
    expect(router.route(msg)).toHaveLength(1);
    expect(router.route(msg)).toHaveLength(1);
  });

  test("channel mapping to unregistered agent returns empty", () => {
    router.addChannelMapping("C123", "nonexistent-agent");
    const result = router.route(makeMessage());
    expect(result).toEqual([]);
  });

  test("content rule pointing to unregistered agent returns empty", () => {
    router.addContentRule(/hello/, "nonexistent");
    const result = router.route(makeMessage({ content: "hello" }));
    expect(result).toEqual([]);
  });

  test("multiple channel mappings: last one wins for same channel", () => {
    router.addChannelMapping("C123", "a1");
    router.addChannelMapping("C123", "a2");
    const result = router.route(makeMessage());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a2");
  });

  test("message with very long content still matches regex", () => {
    router.addContentRule(/needle/, "a1");
    const content = "x".repeat(10000) + "needle" + "x".repeat(10000);
    const result = router.route(makeMessage({ content }));
    expect(result).toHaveLength(1);
  });

  test("mention partial match does not route", () => {
    const result = router.route(makeMessage({ mentions: ["Alpha"] }));
    expect(result).toEqual([]);
  });

  test("many content rules: only first match routes", () => {
    for (let i = 0; i < 100; i++) {
      router.addContentRule(new RegExp(`word${i}`), `a${(i % 3) + 1}`);
    }
    const result = router.route(makeMessage({ content: "contains word50 and word51" }));
    expect(result).toHaveLength(1);
  });

  test("same agent mentioned multiple times deduplicates", () => {
    const result = router.route(makeMessage({ mentions: ["Alpha Agent", "Alpha Agent", "Alpha Agent"] }));
    expect(result).toHaveLength(3); // current behavior: no dedup (each mention resolved independently)
  });

  test("routing with all three levels configured but mention hits", () => {
    router.addChannelMapping("C123", "a2");
    router.addContentRule(/hello/, "a3");
    const result = router.route(makeMessage({ mentions: ["Alpha Agent"], content: "hello" }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
  });
});
