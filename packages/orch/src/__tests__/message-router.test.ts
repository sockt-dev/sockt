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

describe("MessageRouter", () => {
  let registry: AgentRegistry;
  let router: MessageRouter;

  beforeEach(() => {
    registry = new AgentRegistry([
      makeAgent({ id: "growth-arch", name: "Growth Architect", department: "growth" }),
      makeAgent({ id: "content-writer", name: "Content Writer", department: "growth" }),
      makeAgent({ id: "support-agent", name: "Support Agent", department: "support" }),
    ]);
    router = new MessageRouter(registry);
  });

  test("routes by @mention matching agent name", () => {
    const msg = makeMessage({ mentions: ["Growth Architect"] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("growth-arch");
  });

  test("routes multiple agents when multiple @mentions match", () => {
    const msg = makeMessage({ mentions: ["Growth Architect", "Content Writer"] });
    const result = router.route(msg);
    expect(result).toHaveLength(2);
  });

  test("@mention is case-insensitive", () => {
    const msg = makeMessage({ mentions: ["growth architect"] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("growth-arch");
  });

  test("falls through to channel mapping when no mentions match", () => {
    router.addChannelMapping("C123", "support-agent");
    const msg = makeMessage({ mentions: [] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("support-agent");
  });

  test("channel mapping routes to configured agent", () => {
    router.addChannelMapping("C999", "content-writer");
    const msg = makeMessage({ channelId: "C999", mentions: [] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("content-writer");
  });

  test("falls through to content rules when no channel mapping", () => {
    router.addContentRule(/campaign/i, "growth-arch");
    const msg = makeMessage({ content: "plan Q3 campaign", mentions: [] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("growth-arch");
  });

  test("first matching content rule wins", () => {
    router.addContentRule(/campaign/i, "growth-arch");
    router.addContentRule(/plan/i, "content-writer");
    const msg = makeMessage({ content: "plan Q3 campaign", mentions: [] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("growth-arch");
  });

  test("returns empty array when nothing matches", () => {
    const msg = makeMessage({ mentions: ["Unknown Agent"] });
    const result = router.route(msg);
    expect(result).toEqual([]);
  });

  test("@mention takes priority over channel mapping", () => {
    router.addChannelMapping("C123", "support-agent");
    const msg = makeMessage({ mentions: ["Growth Architect"] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("growth-arch");
  });

  test("channel mapping takes priority over content rules", () => {
    router.addChannelMapping("C123", "support-agent");
    router.addContentRule(/campaign/i, "growth-arch");
    const msg = makeMessage({ content: "plan campaign", mentions: [] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("support-agent");
  });

  test("unmatched mentions do not block channel mapping fallback", () => {
    router.addChannelMapping("C123", "support-agent");
    const msg = makeMessage({ mentions: ["Unknown Agent"] });
    const result = router.route(msg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("support-agent");
  });
});
