# OpenRouter Quick Start - Fix for "Error Decoding Response Body"

## Problem
You're getting "error decoding response body" when using OpenRouter as a custom endpoint.

## Solution
Use the dedicated `openrouter` provider instead of `openai` with a custom baseUrl.

### ❌ Don't Do This (Causes Error)
```typescript
const config = {
  provider: "openai",  // Wrong!
  model: "anthropic/claude-3.5-sonnet",
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: "https://openrouter.ai/api/v1",
};
```

### ✅ Do This (Correct)
```typescript
const config = {
  provider: "openrouter",  // Correct!
  model: "anthropic/claude-3.5-sonnet",
  apiKey: process.env.OPENROUTER_API_KEY,
  // baseUrl is optional - defaults to https://openrouter.ai/api/v1
};
```

## Complete Example

```typescript
import { HttpLlmClient } from "@sockt/runtime";

const client = new HttpLlmClient();

try {
  const response = await client.chat({
    messages: [
      { role: "user", content: "Hello! What models can you use?" }
    ],
    config: {
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet", // or any OpenRouter model
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  });

  console.log(response.message.content);
} catch (error) {
  console.error("Error:", error.message);
}
```

## Why This Happens

OpenRouter requires specific headers that the standard OpenAI provider doesn't send:
- `HTTP-Referer`: Identifies your application
- `X-Title`: Application name

The `openrouter` provider automatically adds these headers for you.

## Popular OpenRouter Models

```typescript
// Anthropic models
"anthropic/claude-3.5-sonnet"
"anthropic/claude-opus-4"

// OpenAI models
"openai/gpt-4-turbo"
"openai/gpt-4o"

// Meta Llama models
"meta-llama/llama-3-70b-instruct"
"meta-llama/llama-3.1-405b-instruct"

// Google models
"google/gemini-pro"
"google/gemini-1.5-pro"

// Mistral models
"mistralai/mistral-large"
"mistralai/mixtral-8x7b-instruct"
```

See all models at: https://openrouter.ai/models

## Getting Your API Key

1. Sign up at https://openrouter.ai
2. Go to https://openrouter.ai/keys
3. Create a new API key
4. Add to your environment variables:
   ```bash
   export OPENROUTER_API_KEY="sk-or-v1-..."
   ```

## Testing Your Setup

```typescript
// Simple test
const testConfig = {
  provider: "openrouter" as const,
  model: "anthropic/claude-3.5-sonnet",
  apiKey: process.env.OPENROUTER_API_KEY,
  maxTokens: 100,
};

const response = await client.chat({
  messages: [{ role: "user", content: "Say hello!" }],
  config: testConfig,
});

console.log("✓ OpenRouter working:", response.message.content);
```

## Troubleshooting

### Error: "No LLM config provided"
- Make sure you're passing the `config` parameter

### Error: "API key is required"
- Check that `OPENROUTER_API_KEY` is set
- Verify the environment variable is loaded

### Error: "Invalid model"
- Check the model name format: `provider/model-name`
- Verify the model exists on OpenRouter's website

### Error: "Rate limit exceeded"
- You've exceeded your OpenRouter quota
- Check your usage at https://openrouter.ai/activity

### Error: Still getting "decoding response body"
- Double-check you're using `provider: "openrouter"` (not `"openai"`)
- Verify your API key is valid
- Try a different model to rule out model-specific issues

## Advanced: Custom Configuration

If you need to customize the referer or title:

```typescript
// Edit packages/runtime/src/llm/providers.ts
case "openrouter":
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://yourdomain.com",  // Your domain
      "X-Title": "Your App Name",                // Your app name
    },
  });
```

## Need Help?

1. Check the full documentation: `/docs/openrouter-and-custom-endpoints.md`
2. Report issues: https://github.com/anthropics/claude-code/issues
3. OpenRouter support: https://openrouter.ai/docs
