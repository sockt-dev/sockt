import type { LlmMessage, LlmStreamChunk } from "../types/llm.ts";
import type { LlmRequest, LlmResponse } from "../schemas/llm.schema.ts";

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResponse>;
  stream(request: LlmRequest): AsyncIterable<LlmStreamChunk>;
  countTokens(messages: LlmMessage[]): Promise<number>;
}
