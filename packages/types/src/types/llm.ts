export const LlmProvider = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  Ollama: "ollama",
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
}

export interface LlmMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface LlmStreamChunk {
  delta: string;
  usage?: TokenUsage;
  finishReason?: "stop" | "tool_calls" | "length" | "content_filter";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
