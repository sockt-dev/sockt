import { z } from "zod";
import { LLM_PROVIDER_VALUES, MESSAGE_ROLE_VALUES, ROUTING_STRATEGY_VALUES } from "../types/llm.ts";

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const LlmConfigSchema = z.object({
  provider: z.enum(LLM_PROVIDER_VALUES),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  region: z.string().optional(),
  features: z.object({
    thinking: z.object({
      enabled: z.boolean(),
      budgetTokens: z.number().int().positive().optional(),
      display: z.enum(["summarized", "omitted"]).optional(),
    }).optional(),
    promptCaching: z.object({
      enabled: z.boolean(),
      ttl: z.enum(["5m", "1h"]).optional(),
    }).optional(),
    structuredOutput: z.object({
      enabled: z.boolean(),
      schema: z.record(z.string(), z.unknown()).optional(),
      strict: z.boolean().optional(),
    }).optional(),
    reasoning: z.object({
      effort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
      summary: z.enum(["auto", "concise", "detailed"]).optional(),
    }).optional(),
    guardrailConfig: z.object({
      guardrailIdentifier: z.string(),
      guardrailVersion: z.string(),
    }).optional(),
  }).optional(),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const MessageContentSchema = z.object({
  type: z.enum(["text", "image", "audio", "document", "video"]),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  audioUrl: z.string().optional(),
  audioBase64: z.string().optional(),
  documentUrl: z.string().optional(),
  documentBase64: z.string().optional(),
  mimeType: z.string().optional(),
});
export type MessageContent = z.infer<typeof MessageContentSchema>;

export const LlmMessageSchema = z.object({
  role: z.enum(MESSAGE_ROLE_VALUES),
  content: z.union([z.string(), z.array(MessageContentSchema)]),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

const FINISH_REASON_VALUES = ["stop", "tool_calls", "length", "content_filter"] as const;

export const LlmRequestSchema = z.object({
  messages: z.array(LlmMessageSchema),
  config: LlmConfigSchema,
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })).optional(),
  routing: z.enum(ROUTING_STRATEGY_VALUES).optional(),
});
export type LlmRequest = z.infer<typeof LlmRequestSchema>;

export const LlmResponseSchema = z.object({
  message: LlmMessageSchema,
  usage: TokenUsageSchema,
  model: z.string(),
  finishReason: z.enum(FINISH_REASON_VALUES),
});
export type LlmResponse = z.infer<typeof LlmResponseSchema>;
