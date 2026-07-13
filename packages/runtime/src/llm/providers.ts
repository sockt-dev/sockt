import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGroq } from "@ai-sdk/groq";
import type { LlmConfig } from "@sockt/types";
import { LlmError } from "@sockt/types";

// As of @ai-sdk/openai v4 (AI SDK v7), createOpenAI(...)'s default call
// signature (`provider(modelId)`) uses OpenAI's proprietary Responses API
// (`/responses`), not Chat Completions (`/chat/completions`). Every
// "OpenAI-compatible" target this file talks to — OpenRouter, Ollama, and
// arbitrary custom baseUrls — only implements Chat Completions, so every
// createOpenAI() usage here must explicitly use `.chat(modelId)` instead of
// calling the provider directly.
function openAiCompatible(options: Parameters<typeof createOpenAI>[0]) {
  return createOpenAI(options).chat;
}

export function getProvider(config: LlmConfig) {
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "openai":
      // Auto-detect OpenRouter from baseUrl
      if (config.baseUrl?.includes("openrouter.ai")) {
        return openAiCompatible({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
          headers: {
            "HTTP-Referer": "https://github.com/sockt",
            "X-Title": "Sockt",
          },
        });
      }
      return openAiCompatible({ apiKey: config.apiKey, baseURL: config.baseUrl });
    case "openrouter":
      return openAiCompatible({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": config.baseUrl ?? "https://github.com/sockt",
          "X-Title": "Sockt",
        },
      });
    case "groq":
      return createGroq({ apiKey: config.apiKey });
    case "ollama":
      return openAiCompatible({
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
        return openAiCompatible({
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
        return openAiCompatible({
          apiKey: config.apiKey || "none",
          baseURL: config.baseUrl
        });
      }
      throw new LlmError(`Unsupported provider: ${config.provider}`, { provider: config.provider });
  }
}
