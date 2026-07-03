import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LlmConfig } from "@sockt/types";
import { LlmError } from "@sockt/types";

export function getProvider(config: LlmConfig) {
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "openai":
      // Auto-detect OpenRouter from baseUrl
      if (config.baseUrl?.includes("openrouter.ai")) {
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
          headers: {
            "HTTP-Referer": "https://github.com/sockt",
            "X-Title": "Sockt",
          },
        });
      }
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "openrouter":
      return createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": config.baseUrl ?? "https://github.com/sockt",
          "X-Title": "Sockt",
        },
      });
    case "ollama":
      return createOpenAI({
        baseURL: config.baseUrl ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
    case "bedrock":
      if (!config.region) {
        throw new LlmError("AWS region is required for Bedrock provider", { provider: config.provider });
      }
      return createAmazonBedrock({ region: config.region });
    case "google":
      throw new LlmError("Google provider not yet supported", { provider: config.provider });
    default:
      // Handle unknown providers (like "custom" from Rust CLI) as OpenAI-compatible
      // Auto-detect OpenRouter
      if (config.baseUrl?.includes("openrouter.ai")) {
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
          headers: {
            "HTTP-Referer": "https://github.com/sockt",
            "X-Title": "Sockt",
          },
        });
      }
      // Default to OpenAI-compatible for custom endpoints
      if (config.baseUrl) {
        return createOpenAI({
          apiKey: config.apiKey || "none",
          baseURL: config.baseUrl
        });
      }
      throw new LlmError(`Unsupported provider: ${config.provider}`, { provider: config.provider });
  }
}
