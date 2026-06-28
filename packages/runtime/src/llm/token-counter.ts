import type { LlmMessage } from "@sockt/types";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => {
    const contentStr = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(contentStr) + 4;
  }, 0);
}
