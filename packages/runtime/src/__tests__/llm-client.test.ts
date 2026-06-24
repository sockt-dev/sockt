import { test, expect, describe } from "bun:test";
import { estimateTokens, estimateMessagesTokens } from "../llm/token-counter.ts";
import { isRetryable } from "../llm/retry.ts";

describe("token-counter", () => {
  test("estimateTokens approximates 4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
  });

  test("estimateMessagesTokens sums all messages with overhead", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hi" },
    ];
    const estimate = estimateMessagesTokens(messages);
    expect(estimate).toBe(Math.ceil(16 / 4) + 4 + Math.ceil(2 / 4) + 4);
  });
});

describe("isRetryable", () => {
  test("429 status is retryable", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  test("500 status is retryable", () => {
    expect(isRetryable({ status: 500 })).toBe(true);
  });

  test("503 status is retryable", () => {
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  test("400 status is not retryable", () => {
    expect(isRetryable({ status: 400 })).toBe(false);
  });

  test("ECONNRESET error is retryable", () => {
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
  });

  test("regular error is not retryable", () => {
    expect(isRetryable(new Error("invalid input"))).toBe(false);
  });
});
