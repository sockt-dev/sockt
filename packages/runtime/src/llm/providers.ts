import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LlmConfig } from "@sockt/types";
import { LlmError } from "@sockt/types";

export function getProvider(config: LlmConfig) {
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "openai":
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "ollama":
      return createOpenAI({
        baseURL: config.baseUrl ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
    case "google":
      throw new LlmError("Google provider not yet supported", { provider: config.provider });
    default:
      throw new LlmError(`Unsupported provider: ${config.provider}`, { provider: config.provider });
  }
}
