import { LlmError } from "@sockt/types";

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof LlmError) throw error;

      if (!isRetryable(error) || attempt === maxRetries) {
        throw error instanceof Error
          ? new LlmError(`LLM request failed after ${attempt + 1} attempts: ${error.message}`, { lastError: String(lastError) })
          : new LlmError(`LLM request failed after ${attempt + 1} attempts`, { lastError: String(error) });
      }

      lastError = error;
      const delay = Math.min(100 * 2 ** attempt, 5000);
      await Bun.sleep(delay);
    }
  }

  throw new LlmError("LLM request failed: max retries exhausted", { lastError: String(lastError) });
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status === 429 || error.status >= 500;
  }
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 429 || status >= 500;
  }
  if (error instanceof Error) {
    return error.message.includes("ECONNRESET") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed") ||
      error.message.includes("429") ||
      error.message.includes("500") ||
      error.message.includes("502") ||
      error.message.includes("503");
  }
  return false;
}
