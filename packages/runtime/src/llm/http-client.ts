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

    const result = await withRetry(() =>
      generateText({
        model: provider(config.model),
        messages: this.convertMessages(request.messages),
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      }),
    );

    return this.convertResponse(result, config.model);
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
        if (m.content) {
          parts.push({ type: "text", text: m.content });
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
        const parts: ToolResultPart[] = [
          {
            type: "tool-result",
            toolCallId: m.toolCallId!,
            toolName: "",
            result: m.content,
          },
        ];
        return { role: "tool", content: parts };
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
