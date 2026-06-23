import type {
  MemoryStore,
  MemoryEntry,
  MemoryCategory,
  RetrievalQuery,
  RetrievalResult,
} from "@sockt/types";
import { MemoryError, MEMORY_CATEGORY_VALUES } from "@sockt/types";
import type { GBrainConfig } from "../config.ts";
import { McpTransport } from "./transport.ts";
import { buildJsonRpcRequest, TOOL_NAMES } from "./mcp-tools.ts";
import type { McpJsonRpcResponse } from "./mcp-tools.ts";

export class GBrainMcpClient implements MemoryStore {
  private readonly transport: McpTransport;

  constructor(config: GBrainConfig) {
    this.transport = new McpTransport(config);
  }

  async write(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string> {
    const response = await this.callTool(TOOL_NAMES.MEMORY_CAPTURE, {
      tenantId: entry.tenantId,
      content: entry.content,
      category: entry.category,
      source: entry.source,
      metadata: entry.metadata,
    });
    return response.id as string;
  }

  async search(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const response = await this.callTool(TOOL_NAMES.MEMORY_SEARCH, {
      tenantId: query.tenantId,
      query: query.query,
      categories: query.categories,
      limit: query.limit,
      threshold: query.threshold,
    });
    const results = response.results as Array<{
      id: string;
      tenantId: string;
      category: string;
      content: string;
      source: string;
      metadata?: Record<string, unknown>;
      embedding?: number[];
      createdAt: string;
      score: number;
      rankSource?: string;
    }>;
    return results.map((r) => ({
      entry: {
        id: r.id,
        tenantId: r.tenantId,
        category: r.category as MemoryEntry["category"],
        content: r.content,
        source: r.source,
        metadata: r.metadata,
        embedding: r.embedding,
        createdAt: r.createdAt,
      },
      score: r.score,
      rankSource: (r.rankSource ?? "vector") as RetrievalResult["rankSource"],
    }));
  }

  async deduplicateCheck(
    content: string,
    tenantId: string,
    threshold: number,
  ): Promise<boolean> {
    const results = await this.search({
      tenantId,
      query: content,
      limit: 1,
      threshold,
    });
    return results.length > 0 && results[0]!.score >= threshold;
  }

  async commit(tenantId: string, message: string): Promise<void> {
    await this.callTool(TOOL_NAMES.MEMORY_SYNC, { tenantId, message });
  }

  async listCategories(tenantId: string): Promise<MemoryCategory[]> {
    const response = await this.callTool(TOOL_NAMES.MEMORY_LIST_TOPICS, {
      tenantId,
    });
    const topics = response.topics as string[];
    const validCategories = new Set<string>(MEMORY_CATEGORY_VALUES);
    return topics.filter((t) => validCategories.has(t)) as MemoryCategory[];
  }

  async delete(entryId: string): Promise<void> {
    await this.callTool(TOOL_NAMES.MEMORY_FORGET, { entryId });
  }

  async ping(): Promise<boolean> {
    try {
      await this.transport.send(
        buildJsonRpcRequest("ping", {}),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.transport.send(buildJsonRpcRequest(name, args));
    return this.parseResponse(response, name);
  }

  private parseResponse(
    response: McpJsonRpcResponse,
    toolName: string,
  ): Record<string, unknown> {
    if (response.error) {
      throw new MemoryError(
        `MCP tool "${toolName}" returned error: ${response.error.message}`,
        { code: response.error.code, data: response.error.data },
      );
    }

    const content = response.result?.content;
    if (!content || content.length === 0) {
      throw new MemoryError(
        `MCP tool "${toolName}" returned empty content`,
        { toolName },
      );
    }

    try {
      return JSON.parse(content[0]!.text) as Record<string, unknown>;
    } catch {
      throw new MemoryError(
        `MCP tool "${toolName}" returned invalid JSON`,
        { toolName, text: content[0]!.text },
      );
    }
  }
}
