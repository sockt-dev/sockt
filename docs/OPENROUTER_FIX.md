# OpenRouter "Error Decoding Response Body" Fix

## Problem

When running `sockt init` and selecting "Custom URL" with OpenRouter (`https://openrouter.ai/api/v1`), the verification step fails with "error decoding response body".

## Root Cause

OpenRouter requires two specific HTTP headers on all API requests:
- `HTTP-Referer`: Identifies the application making the request
- `X-Title`: Application name for analytics

Without these headers, OpenRouter returns a response that doesn't match the expected OpenAI format, causing the parser to fail.

## Solution Implemented

**Option 1: Auto-detect OpenRouter and inject headers** (Chosen - Not Bloated)

Instead of adding "OpenRouter" as a separate provider choice in `sockt init`, the system now:
1. Detects OpenRouter URLs automatically (`base_url.contains("openrouter.ai")`)
2. Injects required headers transparently
3. Works both in CLI verification AND runtime execution

### Files Modified

#### 1. Rust CLI - Verification (`rust/sockt-cli/src/tui/llm_verify.rs`)

```rust
async fn verify_custom(
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<String, String> {
    // Auto-detect OpenRouter and add required headers
    let is_openrouter = base_url.contains("openrouter.ai");

    let mut request = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload);

    // Add OpenRouter-specific headers
    if is_openrouter {
        request = request
            .header("HTTP-Referer", "https://github.com/sockt")
            .header("X-Title", "Sockt");
    }

    let resp = request.send().await?;
    // ... rest of verification
}
```

#### 2. TypeScript Runtime - Execution (`packages/runtime/src/llm/providers.ts`)

```typescript
export function getProvider(config: LlmConfig) {
  switch (config.provider) {
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
    
    // ... other providers
    
    default:
      // Handle "custom" from Rust CLI as OpenAI-compatible
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
      // Default to OpenAI-compatible for other custom endpoints
      if (config.baseUrl) {
        return createOpenAI({
          apiKey: config.apiKey || "none",
          baseURL: config.baseUrl
        });
      }
      throw new LlmError(`Unsupported provider: ${config.provider}`);
  }
}
```

## How to Use

### During `sockt init`:

```bash
$ sockt init

# When prompted:
Provider: Custom URL (OpenAI-compatible)
Base URL: https://openrouter.ai/api/v1
API key: sk-or-v1-...
Frontier model: anthropic/claude-3.5-sonnet
Fast model: anthropic/claude-3.5-sonnet

# ✓ Verification now succeeds with proper headers
```

### Result in config:

```yaml
models:
  provider: custom
  frontier: anthropic/claude-3.5-sonnet
  fast: anthropic/claude-3.5-sonnet
  api_key: <encrypted>
  base_url: https://openrouter.ai/api/v1
```

### At Runtime:

The TypeScript runtime automatically:
1. Sees `provider: custom` with `base_url: https://openrouter.ai/...`
2. Detects OpenRouter from the URL
3. Injects required headers
4. Makes successful API calls

## Why This Approach?

### ✅ Advantages
- **Not bloated**: No new provider type in the UI
- **Transparent**: Users don't need to know about the header requirement
- **Future-proof**: Works for any OpenRouter URL variant
- **Minimal code**: Single detection point in each codebase (Rust & TypeScript)
- **Backward compatible**: Existing configs work unchanged

### ❌ Alternative Approaches Rejected

**Option 2: Add "OpenRouter" as a provider choice**
- ❌ Makes the UI more bloated
- ❌ Users need to know the distinction
- ❌ More maintenance (new enum value, new docs, etc.)

**Option 3: Skip verification for custom endpoints**
- ❌ Removes validation entirely
- ❌ Users can't catch typos/errors early
- ❌ Poor UX

## Testing

All existing tests pass:
```bash
$ cd packages/runtime
$ bun test
✓ 107 pass
✓ 0 fail
```

## Other Custom Endpoints

The same approach works for other providers that need special headers. Just add detection logic:

```rust
let is_openrouter = base_url.contains("openrouter.ai");
let is_custom_provider = base_url.contains("custom-provider.com");

if is_openrouter {
    request = request
        .header("HTTP-Referer", "https://github.com/sockt")
        .header("X-Title", "Sockt");
} else if is_custom_provider {
    request = request.header("X-Custom-Header", "value");
}
```

## Popular OpenRouter Models

Works with all OpenRouter models:
- `anthropic/claude-3.5-sonnet`
- `anthropic/claude-opus-4`
- `openai/gpt-4-turbo`
- `openai/gpt-4o`
- `meta-llama/llama-3-70b-instruct`
- `google/gemini-pro`
- `mistralai/mistral-large`

Full list: https://openrouter.ai/models

## Troubleshooting

### Still getting verification errors?

1. **Check the URL**: Must be exactly `https://openrouter.ai/api/v1`
2. **Check API key**: Get it from https://openrouter.ai/keys
3. **Check model name**: Use OpenRouter format `provider/model-name`
4. **Check connectivity**: Try `curl https://openrouter.ai` to verify network access

### Works in verification but fails at runtime?

- Check that the TypeScript runtime has the latest code
- Verify the config file has the correct `base_url`
- Check logs for the actual error message

## Related Files

- Rust CLI verification: `rust/sockt-cli/src/tui/llm_verify.rs`
- TypeScript provider factory: `packages/runtime/src/llm/providers.ts`
- OpenRouter documentation: `docs/openrouter-and-custom-endpoints.md`
- Quick start guide: `docs/OPENROUTER_QUICK_START.md`
