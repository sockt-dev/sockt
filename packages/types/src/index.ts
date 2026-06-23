// ─── Enum-like Constants (runtime values) ─────────────────────────────────────
export { TaskStatus, TASK_STATUS_VALUES } from "./types/task.ts";
export { MemoryCategory, MEMORY_CATEGORY_VALUES } from "./types/memory.ts";
export { LlmProvider, LLM_PROVIDER_VALUES, MessageRole, MESSAGE_ROLE_VALUES, RoutingStrategy, ROUTING_STRATEGY_VALUES } from "./types/llm.ts";
export { Platform, PLATFORM_VALUES } from "./types/channel.ts";
export { HitlTier, HITL_TIER_VALUES, ApprovalStatus, APPROVAL_STATUS_VALUES } from "./types/hitl.ts";
export { CadvpEventType, CADVP_EVENT_TYPE_VALUES } from "./types/cadvp.ts";
export { AgentRole, AGENT_ROLE_VALUES } from "./types/agent.ts";

// ─── Types (non-boundary interfaces from types/) ─────────────────────────────
export type { TaskCreate, TaskPatch } from "./types/task.ts";
export type { LlmConfig, LlmMessage, LlmStreamChunk, TokenUsage, ToolDefinition, ToolCall } from "./types/llm.ts";
export type { Attachment, ChannelInfo } from "./types/channel.ts";
export type { CadvpStats } from "./types/cadvp.ts";
export type { AgentConfig } from "./types/agent.ts";
export type { SandboxConfig, SandboxInstance, ExecResult } from "./types/sandbox.ts";

// ─── Schema-derived Types (cross-boundary) ────────────────────────────────────
export type { Task } from "./schemas/task.schema.ts";
export type { MemoryEntry, RetrievalQuery, RetrievalResult } from "./schemas/memory.schema.ts";
export type { LlmRequest, LlmResponse } from "./schemas/llm.schema.ts";
export type { InboundMessage, OutboundMessage } from "./schemas/channel.schema.ts";
export type { CadvpEvent } from "./schemas/cadvp.schema.ts";
export type { ApprovalRequest, ApprovalDecision } from "./schemas/hitl.schema.ts";

// ─── Interfaces (store abstractions) ──────────────────────────────────────────
export type { TaskStore } from "./interfaces/task-store.ts";
export type { MemoryStore } from "./interfaces/memory-store.ts";
export type { CadvpMonitor } from "./interfaces/cadvp-monitor.ts";
export type { LlmClient } from "./interfaces/llm-client.ts";
export type { Sandbox } from "./interfaces/sandbox.ts";
export type { HitlGate } from "./interfaces/hitl-gate.ts";
export type { ChannelGateway } from "./interfaces/channel-gateway.ts";
export type { OrchClient } from "./interfaces/orch-client.ts";
export type { TelemetryEmitter } from "./interfaces/telemetry-emitter.ts";
export type { ModelSelector, ModelSelectionContext } from "./interfaces/model-selector.ts";

// ─── Zod Schemas (runtime validation) ─────────────────────────────────────────
export { TaskSchema, TaskCreateSchema, TaskPatchSchema } from "./schemas/task.schema.ts";
export { MemoryEntrySchema, RetrievalQuerySchema, RetrievalResultSchema } from "./schemas/memory.schema.ts";
export { LlmConfigSchema, LlmMessageSchema, LlmRequestSchema, LlmResponseSchema, TokenUsageSchema, ToolCallSchema } from "./schemas/llm.schema.ts";
export { InboundMessageSchema, OutboundMessageSchema, AttachmentSchema } from "./schemas/channel.schema.ts";
export { CadvpEventSchema, CadvpStatsSchema } from "./schemas/cadvp.schema.ts";
export { ApprovalRequestSchema, ApprovalDecisionSchema } from "./schemas/hitl.schema.ts";

// ─── Error Classes (runtime) ──────────────────────────────────────────────────
export { SocktError } from "./errors/base.ts";
export { TaskStoreError } from "./errors/task-store.ts";
export { MemoryError } from "./errors/memory.ts";
export { LlmError } from "./errors/llm.ts";
export { SandboxError } from "./errors/sandbox.ts";
export { HitlError } from "./errors/hitl.ts";
