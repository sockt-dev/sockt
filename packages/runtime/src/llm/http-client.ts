import { generateText, streamText, jsonSchema } from "ai";
import type { CoreMessage, CoreTool, ToolCallPart, TextPart, ToolResultPart } from "ai";
import type {
  LlmClient,
  LlmConfig,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ToolDefinition,
} from "@sockt/types";
import { LlmError } from "@sockt/types";
import { getProvider } from "./providers.ts";
import { withRetry } from "./retry.ts";
import { estimateMessagesTokens } from "./token-counter.ts";

export class HttpLlmClient implements LlmClient {
  constructor(private defaultConfig?: LlmConfig) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const config = request.config ?? this.defaultConfig;
    if (!config) throw new LlmError("No LLM config provided", {});

    const provider = getProvider(config);

    const options: any = {
      model: provider(config.model),
      messages: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    };

    if (config.features) {
      if (config.features.thinking?.enabled) {
        options.experimental_thinking = {
          type: "enabled",
          budgetTokens: config.features.thinking.budgetTokens,
          display: config.features.thinking.display,
        };
      }

      if (config.features.structuredOutput?.enabled && config.features.structuredOutput.schema) {
        options.output = jsonSchema(config.features.structuredOutput.schema as any);
      }

      if (config.features.promptCaching?.enabled) {
        options.experimental_providerMetadata = {
          anthropic: {
            cacheControl: { type: "ephemeral" },
          },
        };
      }
    }

    try {
      const result = await withRetry(() => generateText(options));
      return this.convertResponse(result, config.model);
    } catch (error) {
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes("decoding") || errorMsg.includes("invalid json") || errorMsg.includes("unexpected token")) {
          throw new LlmError(
            `Failed to parse response from ${config.provider} provider at ${config.baseUrl || "default URL"}. ` +
            `This may indicate an API incompatibility or incorrect endpoint configuration. ` +
            `For OpenRouter, use provider: "openrouter" or ensure baseUrl points to a valid OpenAI-compatible endpoint. ` +
            `Original error: ${error.message}`,
            {
              provider: config.provider,
              baseUrl: config.baseUrl,
              model: config.model,
              originalError: error.message,
              suggestion: config.provider === "openai" && config.baseUrl?.includes("openrouter")
                ? 'Try setting provider: "openrouter" instead of "openai"'
                : undefined
            }
          );
        }
      }
      throw error;
    }
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const config = request.config ?? this.defaultConfig;
    if (!config) throw new LlmError("No LLM config provided", {});

    const provider = getProvider(config);

    const result = streamText({
      model: provider(config.model),
      messages: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    for await (const chunk of result.textStream) {
      yield { delta: chunk };
    }
  }

  async countTokens(messages: LlmMessage[]): Promise<number> {
    return estimateMessagesTokens(messages);
  }

  private convertMessages(messages: LlmMessage[]): CoreMessage[] {
    return messages.map((m): CoreMessage => {
      if (m.role === "assistant" && m.toolCalls?.length) {
        const parts: (TextPart | ToolCallPart)[] = [];
        const contentStr = typeof m.content === "string" ? m.content : "";
        if (contentStr) {
          parts.push({ type: "text", text: contentStr });
        }
        for (const tc of m.toolCalls) {
          parts.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.arguments,
          });
        }
        return { role: "assistant", content: parts };
      }

      if (m.role === "tool") {
        const contentStr = typeof m.content === "string" ? m.content : "";
        const parts: ToolResultPart[] = [
          {
            type: "tool-result",
            toolCallId: m.toolCallId!,
            toolName: "",
            result: contentStr,
          },
        ];
        return { role: "tool", content: parts };
      }

      if (Array.isArray(m.content)) {
        const parts = m.content.map(content => {
          switch (content.type) {
            case "text":
              return { type: "text" as const, text: content.text ?? "" };
            case "image":
              return {
                type: "image" as const,
                image: content.imageUrl || content.imageBase64 || "",
                mimeType: content.mimeType,
              };
            case "audio":
              return {
                type: "file" as const,
                data: content.audioUrl || content.audioBase64 || "",
                mimeType: content.mimeType || "audio/wav",
              };
            case "document":
              return {
                type: "file" as const,
                data: content.documentUrl || content.documentBase64 || "",
                mimeType: content.mimeType || "application/pdf",
              };
            case "video":
              return {
                type: "file" as const,
                data: content.imageUrl || content.imageBase64 || "",
                mimeType: content.mimeType || "video/mp4",
              };
            default:
              throw new LlmError(`Unsupported content type: ${(content as any).type}`, {});
          }
        });
        return { role: "user" as const, content: parts as any };
      }

      return { role: m.role as "system" | "user" | "assistant", content: m.content };
    });
  }

  private convertTools(tools: ToolDefinition[]): Record<string, CoreTool> {
    const result: Record<string, CoreTool> = {};
    for (const t of tools) {
      result[t.name] = {
        description: t.description,
        parameters: jsonSchema(t.parameters as any),
      };
    }
    return result;
  }

  private convertResponse(result: any, model: string): LlmResponse {
    const toolCalls = result.toolCalls?.map((tc: any) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: tc.args,
    }));

    const finishReason = this.normalizeFinishReason(result.finishReason);

    return {
      message: {
        role: "assistant",
        content: result.text ?? "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
        cacheReadInputTokens: result.usage?.cacheReadInputTokens,
        cacheWriteInputTokens: result.usage?.cacheWriteInputTokens,
        reasoningTokens: result.experimental_thinking?.thinkingTokens,
      },
      model,
      finishReason,
    };
  }

  private normalizeFinishReason(reason: string): "stop" | "tool_calls" | "length" | "content_filter" {
    switch (reason) {
      case "tool-calls":
        return "tool_calls";
      case "content-filter":
        return "content_filter";
      case "length":
        return "length";
      default:
        return "stop";
    }
  }
}
