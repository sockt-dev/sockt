import { test, expect, describe } from "bun:test";
import { withRetry, isRetryable } from "../llm/retry.ts";
import { LlmError } from "@sockt/types";

describe("withRetry", () => {
  test("returns immediately on success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries on retryable error and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("fetch failed");
      return "recovered";
    }, 3);
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  test("throws after max retries exhausted", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("fetch failed");
      }, 2);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).message).toContain("3 attempts");
      expect(calls).toBe(3);
    }
  });

  test("does not retry non-retryable errors", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("invalid API key");
      }, 3);
      expect(true).toBe(false);
    } catch (error) {
      expect(calls).toBe(1);
      expect(error).toBeInstanceOf(LlmError);
    }
  });

  test("rethrows LlmError without wrapping", async () => {
    const original = new LlmError("custom error", { detail: "test" });
    try {
      await withRetry(async () => { throw original; }, 3);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBe(original);
    }
  });

  test("respects retry count of 0", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("fetch failed");
      }, 0);
      expect(true).toBe(false);
    } catch {
      expect(calls).toBe(1);
    }
  });

  test("backoff delay increases between retries", async () => {
    const timestamps: number[] = [];
    try {
      await withRetry(async () => {
        timestamps.push(performance.now());
        throw new Error("503");
      }, 2);
    } catch {}

    expect(timestamps.length).toBe(3);
    const firstGap = timestamps[1]! - timestamps[0]!;
    const secondGap = timestamps[2]! - timestamps[1]!;
    expect(firstGap).toBeGreaterThanOrEqual(80);
    expect(secondGap).toBeGreaterThan(firstGap * 1.5);
  });
});

describe("isRetryable - comprehensive", () => {
  test("Response object with 429", () => {
    expect(isRetryable(new Response(null, { status: 429 }))).toBe(true);
  });

  test("Response object with 500", () => {
    expect(isRetryable(new Response(null, { status: 500 }))).toBe(true);
  });

  test("Response object with 502", () => {
    expect(isRetryable(new Response(null, { status: 502 }))).toBe(true);
  });

  test("Response object with 401 is not retryable", () => {
    expect(isRetryable(new Response(null, { status: 401 }))).toBe(false);
  });

  test("plain object with status field", () => {
    expect(isRetryable({ status: 429, message: "rate limited" })).toBe(true);
    expect(isRetryable({ status: 403 })).toBe(false);
  });

  test("ECONNREFUSED is retryable", () => {
    expect(isRetryable(new Error("connect ECONNREFUSED 127.0.0.1:3000"))).toBe(true);
  });

  test("null/undefined is not retryable", () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });

  test("string is not retryable", () => {
    expect(isRetryable("error")).toBe(false);
  });
});
