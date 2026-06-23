import { MemoryError } from "@sockt/types";
import type { GBrainConfig } from "../config.ts";
import type { McpJsonRpcRequest, McpJsonRpcResponse } from "./mcp-tools.ts";

export class McpTransport {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(config: GBrainConfig) {
    this.endpoint = config.endpoint;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.retries = config.retries ?? 3;
  }

  async send(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(`${this.endpoint}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          return (await response.json()) as McpJsonRpcResponse;
        }

        if (this.isRetryable(response.status) && attempt < this.retries) {
          lastError = new Error(`HTTP ${response.status}`);
          await this.backoff(attempt);
          continue;
        }

        throw new MemoryError(
          `MCP request failed: HTTP ${response.status}`,
          { tool: request.params.name, status: response.status },
        );
      } catch (error) {
        if (error instanceof MemoryError) throw error;

        if (attempt < this.retries) {
          lastError = error;
          await this.backoff(attempt);
          continue;
        }

        throw new MemoryError(
          `MCP request failed after ${this.retries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`,
          { tool: request.params.name, lastError: String(lastError) },
        );
      }
    }

    throw new MemoryError(
      `MCP request failed after ${this.retries + 1} attempts`,
      { tool: request.params.name },
    );
  }

  private isRetryable(status: number): boolean {
    return status >= 500 || status === 429;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(100 * 2 ** attempt, 5000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
