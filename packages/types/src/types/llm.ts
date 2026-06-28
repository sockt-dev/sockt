export const LlmProvider = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  Ollama: "ollama",
  Bedrock: "bedrock",
  OpenRouter: "openrouter",
} as const;
export type LlmProvider = (typeof LlmProvider)[keyof typeof LlmProvider];
export const LLM_PROVIDER_VALUES = Object.values(LlmProvider) as [LlmProvider, ...LlmProvider[]];

export const MessageRole = {
  System: "system",
  User: "user",
  Assistant: "assistant",
  Tool: "tool",
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];
export const MESSAGE_ROLE_VALUES = Object.values(MessageRole) as [MessageRole, ...MessageRole[]];

export const RoutingStrategy = {
  Cost: "cost",
  Quality: "quality",
  Speed: "speed",
  Fallback: "fallback",
} as const;
export type RoutingStrategy = (typeof RoutingStrategy)[keyof typeof RoutingStrategy];
export const ROUTING_STRATEGY_VALUES = Object.values(RoutingStrategy) as [RoutingStrategy, ...RoutingStrategy[]];

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  region?: string;
  features?: {
    thinking?: {
      enabled: boolean;
      budgetTokens?: number;
      display?: "summarized" | "omitted";
    };
    promptCaching?: {
      enabled: boolean;
      ttl?: "5m" | "1h";
    };
    structuredOutput?: {
      enabled: boolean;
      schema?: Record<string, unknown>;
      strict?: boolean;
    };
    reasoning?: {
      effort?: "none" | "low" | "medium" | "high" | "xhigh";
      summary?: "auto" | "concise" | "detailed";
    };
    guardrailConfig?: {
      guardrailIdentifier: string;
      guardrailVersion: string;
    };
  };
}

export interface MessageContent {
  type: "text" | "image" | "audio" | "document" | "video";
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  audioUrl?: string;
  audioBase64?: string;
  documentUrl?: string;
  documentBase64?: string;
  mimeType?: string;
}

export interface LlmMessage {
  role: MessageRole;
  content: string | MessageContent[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LlmStreamChunk {
  delta: string;
  usage?: TokenUsage;
  finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
  thinking?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
