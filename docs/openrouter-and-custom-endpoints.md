# OpenRouter and Custom Endpoints Guide

This guide explains how to use OpenRouter and other custom OpenAI-compatible endpoints with the Sockt LLM client.

## OpenRouter

OpenRouter provides access to multiple LLM providers through a unified API. The Sockt client now has first-class support for OpenRouter.

### Basic Usage

```typescript
import { HttpLlmClient } from "@sockt/runtime";

const client = new HttpLlmClient();

const response = await client.chat({
  messages: [{ role: "user", content: "Hello!" }],
  config: {
    provider: "openrouter",
    model: "anthropic/claude-3.5-sonnet",
    apiKey: process.env.OPENROUTER_API_KEY,
  },
});
```

### Features

- **Automatic Headers**: The client automatically adds required OpenRouter headers:
  - `HTTP-Referer`: Identifies your application
  - `X-Title`: Application name

- **Default Base URL**: Uses `https://openrouter.ai/api/v1` by default

- **Custom Base URL**: Override if needed:
  ```typescript
  config: {
    provider: "openrouter",
    model: "anthropic/claude-3.5-sonnet",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
  }
  ```

### Supported Models

OpenRouter supports hundreds of models. Common examples:

- `anthropic/claude-3.5-sonnet`
- `anthropic/claude-opus-4`
- `openai/gpt-4-turbo`
- `openai/gpt-4o`
- `meta-llama/llama-3-70b-instruct`
- `google/gemini-pro`
- `mistralai/mistral-large`

See [OpenRouter's model list](https://openrouter.ai/models) for the full catalog.

## Other Custom Endpoints

### Using OpenAI-Compatible Endpoints

Many services provide OpenAI-compatible APIs. You can use them with the `openai` provider:

```typescript
const response = await client.chat({
  messages: [{ role: "user", content: "Hello!" }],
  config: {
    provider: "openai",
    model: "your-model-name",
    apiKey: "your-api-key",
    baseUrl: "https://your-endpoint.com/v1",
  },
});
```

### Examples

#### Together.ai
```typescript
config: {
  provider: "openai",
  model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  apiKey: process.env.TOGETHER_API_KEY,
  baseUrl: "https://api.together.xyz/v1",
}
```

#### Anyscale
```typescript
config: {
  provider: "openai",
  model: "meta-llama/Llama-3-70b-chat-hf",
  apiKey: process.env.ANYSCALE_API_KEY,
  baseUrl: "https://api.endpoints.anyscale.com/v1",
}
```

#### Perplexity
```typescript
config: {
  provider: "openai",
  model: "llama-3.1-sonar-large-128k-online",
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseUrl: "https://api.perplexity.ai",
}
```

#### Groq
```typescript
config: {
  provider: "openai",
  model: "llama-3.1-70b-versatile",
  apiKey: process.env.GROQ_API_KEY,
  baseUrl: "https://api.groq.com/openai/v1",
}
```

## Troubleshooting

### Error: "Failed to decode response body"

This error typically means the endpoint is not fully OpenAI-compatible. Try:

1. **For OpenRouter**: Use `provider: "openrouter"` instead of `provider: "openai"`
2. **Check the base URL**: Ensure it points to the correct API endpoint (usually ends with `/v1`)
3. **Verify API key**: Make sure your API key is valid and has proper permissions
4. **Check model name**: Ensure the model name format matches the provider's requirements

### Error: "Invalid JSON response"

The endpoint returned a non-JSON response. This could be:
- An HTML error page (check if the URL is correct)
- A text error message (check API key and permissions)
- A rate limit response (check your usage limits)

### Error: "LLM request failed after 3 attempts"

The request is being retried but failing. Check:
1. Network connectivity
2. API endpoint status (check provider's status page)
3. Rate limits (429 errors)
4. Invalid configuration (model name, endpoint URL)

## Best Practices

### 1. Environment Variables

Store API keys in environment variables:

```typescript
const config = {
  provider: "openrouter" as const,
  model: "anthropic/claude-3.5-sonnet",
  apiKey: process.env.OPENROUTER_API_KEY,
};
```

### 2. Error Handling

Wrap LLM calls in try-catch blocks:

```typescript
import { LlmError } from "@sockt/types";

try {
  const response = await client.chat(request);
  console.log(response.message.content);
} catch (error) {
  if (error instanceof LlmError) {
    console.error("LLM Error:", error.message);
    console.error("Context:", error.context);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

### 3. Model Selection

Different providers have different model naming conventions:
- **OpenRouter**: `provider/model-name` (e.g., `anthropic/claude-3.5-sonnet`)
- **OpenAI**: Just the model name (e.g., `gpt-4-turbo`)
- **Bedrock**: ARN-style IDs (e.g., `anthropic.claude-3-5-sonnet-20241022-v2:0`)

### 4. Testing Endpoints

Test new endpoints with a simple request first:

```typescript
const testRequest = {
  messages: [{ role: "user", content: "Hello, can you respond?" }],
  config: {
    provider: "openai",
    model: "your-model",
    apiKey: "your-key",
    baseUrl: "your-endpoint",
    maxTokens: 100,
  },
};

try {
  const response = await client.chat(testRequest);
  console.log("✓ Endpoint working:", response.message.content);
} catch (error) {
  console.error("✗ Endpoint test failed:", error);
}
```

## Provider Comparison

| Feature | OpenRouter | Custom OpenAI | Ollama | Bedrock |
|---------|-----------|---------------|--------|---------|
| Setup | API key only | API key + URL | Local install | AWS credentials + region |
| Cost | Pay-per-use | Varies | Free (local) | Pay-per-use |
| Models | 100+ models | Provider-specific | Open source | AWS-hosted models |
| Latency | Cloud | Varies | Local (fast) | Cloud |
| Best for | Multi-model access | Specific providers | Development/testing | AWS infrastructure |

## Advanced Configuration

### Custom Headers

For providers that need custom headers, use the `openai` provider with custom configuration:

```typescript
import { createOpenAI } from "@ai-sdk/openai";

// Note: This requires modifying the providers.ts file
const customProvider = createOpenAI({
  apiKey: "your-key",
  baseURL: "https://api.example.com/v1",
  headers: {
    "X-Custom-Header": "value",
  },
});
```

### Streaming

All providers support streaming:

```typescript
for await (const chunk of client.stream(request)) {
  process.stdout.write(chunk.delta);
}
```

### Token Counting

Estimate tokens before making a request:

```typescript
const messages = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hello!" },
];

const tokenCount = await client.countTokens(messages);
console.log(`Estimated tokens: ${tokenCount}`);
```

## Support

If you encounter issues:

1. Check this documentation
2. Review error messages carefully - they often contain helpful suggestions
3. Verify your configuration matches the provider's requirements
4. Test with a simple request first
5. Check the provider's status page for outages
6. Report issues at: https://github.com/anthropics/claude-code/issues
