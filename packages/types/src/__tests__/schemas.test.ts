import { test, expect, describe } from "bun:test";
import {
  TaskSchema,
  TaskCreateSchema,
  TaskPatchSchema,
  TaskStatus,
  TASK_STATUS_VALUES,
  MemoryEntrySchema,
  RetrievalQuerySchema,
  RetrievalResultSchema,
  MemoryCategory,
  MEMORY_CATEGORY_VALUES,
  LlmConfigSchema,
  LlmMessageSchema,
  LlmRequestSchema,
  LlmResponseSchema,
  TokenUsageSchema,
  ToolCallSchema,
  InboundMessageSchema,
  OutboundMessageSchema,
  AttachmentSchema,
  Platform,
  PLATFORM_VALUES,
  CadvpEventSchema,
  CadvpStatsSchema,
  CadvpEventType,
  CADVP_EVENT_TYPE_VALUES,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  HitlTier,
  HITL_TIER_VALUES,
  ApprovalStatus,
  APPROVAL_STATUS_VALUES,
} from "../index.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validTask = {
  id: "01234567-89ab-cdef-0123-456789abcdef",
  tenantId: "tenant-1",
  status: "pending",
  owner: null,
  parentId: null,
  description: "Test task",
  output: null,
  llmCallsUsed: 0,
  llmCallsBudget: 50,
  attemptCount: 0,
  maxAttempts: 3,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const validMemoryEntry = {
  id: "mem-001",
  tenantId: "tenant-1",
  category: "fact",
  content: "The sky is blue",
  source: "observation",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const validLlmConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  temperature: 0.7,
};

const validToolCall = {
  id: "call-1",
  name: "search",
  arguments: { query: "hello" },
};

const validLlmMessage = {
  role: "user",
  content: "Hello",
};

const validAttachment = {
  type: "file" as const,
  url: "https://example.com/file.pdf",
  name: "file.pdf",
  mimeType: "application/pdf",
};

const validInboundMessage = {
  id: "msg-1",
  platform: "slack",
  channelId: "C123",
  userId: "U456",
  content: "Hello bot",
  attachments: [validAttachment],
  mentions: ["U789"],
  timestamp: "2024-01-01T00:00:00.000Z",
  tenantId: "tenant-1",
};

const validCadvpEvent = {
  type: "memory_write",
  tenantId: "tenant-1",
  agentId: "agent-1",
  entry: validMemoryEntry,
  timestamp: "2024-01-01T00:00:00.000Z",
};

const validApprovalRequest = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  taskId: "task-1",
  tier: "confirm",
  action: "deploy",
  description: "Deploy to production",
};

// ─── Task Schema Tests ────────────────────────────────────────────────────────

describe("TaskSchema", () => {
  test("round-trips through JSON", () => {
    const parsed = TaskSchema.parse(validTask);
    const restored = TaskSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("accepts all TaskStatus values", () => {
    for (const status of TASK_STATUS_VALUES) {
      expect(() => TaskSchema.parse({ ...validTask, status })).not.toThrow();
    }
  });

  test("rejects invalid status", () => {
    expect(() => TaskSchema.parse({ ...validTask, status: "invalid" })).toThrow();
  });

  test("rejects missing required fields", () => {
    const { id: _, ...incomplete } = validTask;
    expect(() => TaskSchema.parse(incomplete)).toThrow();
  });

  test("rejects negative llmCallsUsed", () => {
    expect(() => TaskSchema.parse({ ...validTask, llmCallsUsed: -1 })).toThrow();
  });
});

describe("TaskCreateSchema", () => {
  test("parses valid create payload", () => {
    const result = TaskCreateSchema.parse({ tenantId: "t1", description: "do thing" });
    expect(result.tenantId).toBe("t1");
  });

  test("accepts optional fields", () => {
    const result = TaskCreateSchema.parse({
      tenantId: "t1",
      description: "do thing",
      parentId: "parent-1",
      llmCallsBudget: 100,
      maxAttempts: 5,
    });
    expect(result.parentId).toBe("parent-1");
  });
});

describe("TaskPatchSchema", () => {
  test("accepts partial updates", () => {
    const result = TaskPatchSchema.parse({ status: "completed", output: "done" });
    expect(result.status).toBe("completed");
  });

  test("accepts empty object", () => {
    const result = TaskPatchSchema.parse({});
    expect(result).toEqual({});
  });
});

// ─── Memory Schema Tests ──────────────────────────────────────────────────────

describe("MemoryEntrySchema", () => {
  test("round-trips through JSON", () => {
    const parsed = MemoryEntrySchema.parse(validMemoryEntry);
    const restored = MemoryEntrySchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("accepts all MemoryCategory values", () => {
    for (const category of MEMORY_CATEGORY_VALUES) {
      expect(() => MemoryEntrySchema.parse({ ...validMemoryEntry, category })).not.toThrow();
    }
  });

  test("accepts optional metadata and embedding", () => {
    const withOptionals = {
      ...validMemoryEntry,
      metadata: { key: "value" },
      embedding: [0.1, 0.2, 0.3],
    };
    const parsed = MemoryEntrySchema.parse(withOptionals);
    expect(parsed.metadata).toEqual({ key: "value" });
    expect(parsed.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("RetrievalQuerySchema", () => {
  test("parses minimal query", () => {
    const result = RetrievalQuerySchema.parse({ tenantId: "t1", query: "search term" });
    expect(result.query).toBe("search term");
  });

  test("accepts optional filters", () => {
    const result = RetrievalQuerySchema.parse({
      tenantId: "t1",
      query: "search",
      categories: ["fact", "decision"],
      limit: 10,
      threshold: 0.8,
    });
    expect(result.categories).toEqual(["fact", "decision"]);
  });

  test("rejects threshold > 1", () => {
    expect(() => RetrievalQuerySchema.parse({
      tenantId: "t1", query: "q", threshold: 1.5,
    })).toThrow();
  });
});

describe("RetrievalResultSchema", () => {
  test("parses valid result", () => {
    const result = RetrievalResultSchema.parse({
      entry: validMemoryEntry,
      score: 0.95,
      rankSource: "vector",
    });
    expect(result.score).toBe(0.95);
  });
});

// ─── LLM Schema Tests ─────────────────────────────────────────────────────────

describe("LlmConfigSchema", () => {
  test("round-trips through JSON", () => {
    const parsed = LlmConfigSchema.parse(validLlmConfig);
    const restored = LlmConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("rejects temperature > 2", () => {
    expect(() => LlmConfigSchema.parse({ ...validLlmConfig, temperature: 3 })).toThrow();
  });
});

describe("LlmMessageSchema", () => {
  test("parses simple message", () => {
    const result = LlmMessageSchema.parse(validLlmMessage);
    expect(result.role).toBe("user");
  });

  test("accepts tool calls", () => {
    const result = LlmMessageSchema.parse({
      role: "assistant",
      content: "",
      toolCalls: [validToolCall],
    });
    expect(result.toolCalls).toHaveLength(1);
  });
});

describe("LlmRequestSchema", () => {
  test("parses minimal request", () => {
    const result = LlmRequestSchema.parse({
      messages: [validLlmMessage],
      config: validLlmConfig,
    });
    expect(result.messages).toHaveLength(1);
  });

  test("accepts tools and routing", () => {
    const result = LlmRequestSchema.parse({
      messages: [validLlmMessage],
      config: validLlmConfig,
      tools: [{ name: "search", description: "Search the web", parameters: {} }],
      routing: "quality",
    });
    expect(result.tools).toHaveLength(1);
    expect(result.routing).toBe("quality");
  });
});

describe("LlmResponseSchema", () => {
  test("parses valid response", () => {
    const result = LlmResponseSchema.parse({
      message: { role: "assistant", content: "Hello!" },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: "claude-sonnet-4-20250514",
      finishReason: "stop",
    });
    expect(result.finishReason).toBe("stop");
  });
});

// ─── Channel Schema Tests ─────────────────────────────────────────────────────

describe("InboundMessageSchema", () => {
  test("round-trips through JSON", () => {
    const parsed = InboundMessageSchema.parse(validInboundMessage);
    const restored = InboundMessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("accepts all Platform values", () => {
    for (const platform of PLATFORM_VALUES) {
      expect(() => InboundMessageSchema.parse({ ...validInboundMessage, platform })).not.toThrow();
    }
  });
});

describe("OutboundMessageSchema", () => {
  test("parses minimal outbound message", () => {
    const result = OutboundMessageSchema.parse({
      platform: "slack",
      channelId: "C123",
      content: "Hello!",
      tenantId: "t1",
    });
    expect(result.content).toBe("Hello!");
  });
});

// ─── CADVP Schema Tests ───────────────────────────────────────────────────────

describe("CadvpEventSchema", () => {
  test("round-trips through JSON", () => {
    const parsed = CadvpEventSchema.parse(validCadvpEvent);
    const restored = CadvpEventSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("accepts all CadvpEventType values", () => {
    for (const type of CADVP_EVENT_TYPE_VALUES) {
      expect(() => CadvpEventSchema.parse({ ...validCadvpEvent, type })).not.toThrow();
    }
  });
});

describe("CadvpStatsSchema", () => {
  test("parses valid stats", () => {
    const result = CadvpStatsSchema.parse({
      eventsProcessed: 100,
      eventsDeduplicated: 5,
      eventsErrored: 2,
      lastProcessedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.eventsProcessed).toBe(100);
  });

  test("accepts null lastProcessedAt", () => {
    const result = CadvpStatsSchema.parse({
      eventsProcessed: 0,
      eventsDeduplicated: 0,
      eventsErrored: 0,
      lastProcessedAt: null,
    });
    expect(result.lastProcessedAt).toBeNull();
  });
});

// ─── HITL Schema Tests ────────────────────────────────────────────────────────

describe("ApprovalRequestSchema", () => {
  test("round-trips through JSON", () => {
    const parsed = ApprovalRequestSchema.parse(validApprovalRequest);
    const restored = ApprovalRequestSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(restored).toEqual(parsed);
  });

  test("accepts all HitlTier values", () => {
    for (const tier of HITL_TIER_VALUES) {
      expect(() => ApprovalRequestSchema.parse({ ...validApprovalRequest, tier })).not.toThrow();
    }
  });

  test("accepts optional id and context", () => {
    const result = ApprovalRequestSchema.parse({
      ...validApprovalRequest,
      id: "req-1",
      context: { env: "production" },
      timeoutMs: 30000,
    });
    expect(result.id).toBe("req-1");
  });
});

describe("ApprovalDecisionSchema", () => {
  test("parses valid decision", () => {
    const result = ApprovalDecisionSchema.parse({
      status: "approved",
      decidedBy: "user-1",
      reason: "Looks good",
      decidedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.status).toBe("approved");
  });

  test("accepts all ApprovalStatus values", () => {
    for (const status of APPROVAL_STATUS_VALUES) {
      expect(() => ApprovalDecisionSchema.parse({ status })).not.toThrow();
    }
  });
});

// ─── Exhaustiveness Tests ─────────────────────────────────────────────────────

describe("enum exhaustiveness", () => {
  test("TaskStatus has 6 values", () => {
    expect(Object.values(TaskStatus)).toHaveLength(6);
  });

  test("MemoryCategory has 5 values", () => {
    expect(Object.values(MemoryCategory)).toHaveLength(5);
  });

  test("Platform has 5 values", () => {
    expect(Object.values(Platform)).toHaveLength(5);
  });

  test("CadvpEventType has 4 values", () => {
    expect(Object.values(CadvpEventType)).toHaveLength(4);
  });

  test("HitlTier has 3 values", () => {
    expect(Object.values(HitlTier)).toHaveLength(3);
  });

  test("ApprovalStatus has 4 values", () => {
    expect(Object.values(ApprovalStatus)).toHaveLength(4);
  });
});
