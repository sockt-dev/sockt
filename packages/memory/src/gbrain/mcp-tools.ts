export const TOOL_NAMES = {
  MEMORY_CAPTURE: "memory_capture",
  MEMORY_SEARCH: "memory_search",
  MEMORY_SYNC: "memory_sync",
  MEMORY_LIST_TOPICS: "memory_list_topics",
  MEMORY_FORGET: "memory_forget",
} as const;

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  method: "tools/call";
  params: { name: string; arguments: Record<string, unknown> };
  id: string;
}

export interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: { content: Array<{ type: string; text: string }> };
  error?: { code: number; message: string; data?: unknown };
}

export function buildJsonRpcRequest(
  toolName: string,
  args: Record<string, unknown>,
): McpJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id: crypto.randomUUID(),
  };
}
