import type { MemoryStore } from "./store.ts";

interface McpRequest {
  jsonrpc: "2.0";
  method: string;
  params: { name: string; arguments: Record<string, unknown> };
  id: string;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: string;
  result?: { content: Array<{ type: string; text: string }> };
  error?: { code: number; message: string; data?: unknown };
}

function success(id: string, data: unknown): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(data) }] },
  };
}

function error(id: string, code: number, message: string): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

export function handleMcpRequest(store: MemoryStore, request: McpRequest): McpResponse {
  const { id, method, params } = request;

  if (method !== "tools/call") {
    return error(id, -32601, `Unknown method: ${method}`);
  }

  const args = params.arguments;

  switch (params.name) {
    case "memory_capture": {
      const entryId = store.write({
        tenantId: args.tenantId as string,
        content: args.content as string,
        category: args.category as string,
        source: args.source as string,
        metadata: args.metadata as Record<string, unknown> | undefined,
      });
      return success(id, { id: entryId });
    }

    case "memory_search": {
      const rows = store.search({
        tenantId: args.tenantId as string,
        query: args.query as string,
        categories: args.categories as string[] | undefined,
        limit: args.limit as number | undefined,
        threshold: args.threshold as number | undefined,
      });
      const results = rows.map((row, i) => ({
        id: row.id,
        tenantId: row.tenant_id,
        category: row.category,
        content: row.content,
        source: row.source,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
        score: 1 - i * 0.05,
        rankSource: "text",
      }));
      return success(id, { results });
    }

    case "memory_sync": {
      store.commit(args.tenantId as string, args.message as string);
      return success(id, { success: true });
    }

    case "memory_list_topics": {
      const topics = store.listCategories(args.tenantId as string);
      return success(id, { topics });
    }

    case "memory_forget": {
      const deleted = store.delete(args.entryId as string);
      return success(id, { success: deleted });
    }

    default:
      return error(id, -32601, `Unknown tool: ${params.name}`);
  }
}
