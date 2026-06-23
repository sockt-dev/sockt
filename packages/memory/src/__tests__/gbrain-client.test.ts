import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { GBrainMcpClient } from "../gbrain/client.ts";
import { MemoryError } from "@sockt/types";

describe("GBrainMcpClient", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let lastRequest: { name: string; arguments: Record<string, unknown> } | null;
  let responseMap: Record<string, unknown>;

  beforeAll(() => {
    responseMap = {
      memory_capture: { id: "mem-123" },
      memory_search: {
        results: [
          {
            id: "mem-1",
            tenantId: "t1",
            category: "fact",
            content: "test content",
            source: "test",
            createdAt: "2024-01-01T00:00:00Z",
            score: 0.95,
            rankSource: "vector",
          },
        ],
      },
      memory_sync: { success: true },
      memory_list_topics: { topics: ["fact", "decision", "unknown_topic"] },
      memory_forget: { success: true },
      ping: { pong: true },
    };

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          params: { name: string; arguments: Record<string, unknown> };
        };
        lastRequest = body.params;
        const toolName = body.params.name;
        const result = responseMap[toolName];

        if (!result) {
          return Response.json({
            jsonrpc: "2.0",
            id: "test",
            error: { code: -32601, message: "Unknown tool" },
          });
        }

        return Response.json({
          jsonrpc: "2.0",
          id: "test",
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("write() sends memory_capture and returns id", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    const id = await client.write({
      tenantId: "t1",
      category: "fact",
      content: "The sky is blue",
      source: "observation",
    });

    expect(id).toBe("mem-123");
    expect(lastRequest!.name).toBe("memory_capture");
    expect(lastRequest!.arguments.tenantId).toBe("t1");
    expect(lastRequest!.arguments.content).toBe("The sky is blue");
    expect(lastRequest!.arguments.category).toBe("fact");
    expect(lastRequest!.arguments.source).toBe("observation");
  });

  test("search() sends memory_search and maps results", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    const results = await client.search({
      tenantId: "t1",
      query: "test",
      limit: 5,
      threshold: 0.8,
    });

    expect(lastRequest!.name).toBe("memory_search");
    expect(lastRequest!.arguments.tenantId).toBe("t1");
    expect(lastRequest!.arguments.query).toBe("test");
    expect(lastRequest!.arguments.limit).toBe(5);
    expect(lastRequest!.arguments.threshold).toBe(0.8);

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe("mem-1");
    expect(results[0]!.score).toBe(0.95);
    expect(results[0]!.rankSource).toBe("vector");
  });

  test("deduplicateCheck() returns true when similar content found", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    const isDuplicate = await client.deduplicateCheck("test content", "t1", 0.92);
    expect(isDuplicate).toBe(true);
  });

  test("deduplicateCheck() returns false when below threshold", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    // The mock returns score 0.95, so a threshold of 0.99 should return false
    const isDuplicate = await client.deduplicateCheck("test content", "t1", 0.99);
    expect(isDuplicate).toBe(false);
  });

  test("commit() sends memory_sync with tenantId and message", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    await client.commit("t1", "checkpoint: user session");

    expect(lastRequest!.name).toBe("memory_sync");
    expect(lastRequest!.arguments.tenantId).toBe("t1");
    expect(lastRequest!.arguments.message).toBe("checkpoint: user session");
  });

  test("listCategories() filters to valid MemoryCategory values", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    const categories = await client.listCategories("t1");

    expect(lastRequest!.name).toBe("memory_list_topics");
    expect(lastRequest!.arguments.tenantId).toBe("t1");
    // "unknown_topic" should be filtered out
    expect(categories).toEqual(["fact", "decision"]);
  });

  test("delete() sends memory_forget with entryId", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    await client.delete("mem-456");

    expect(lastRequest!.name).toBe("memory_forget");
    expect(lastRequest!.arguments.entryId).toBe("mem-456");
  });

  test("ping() returns true when server is healthy", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    const healthy = await client.ping();
    expect(healthy).toBe(true);
  });

  test("ping() returns false when server is unreachable", async () => {
    const client = new GBrainMcpClient({
      endpoint: "http://localhost:1",
      timeoutMs: 100,
      retries: 0,
    });
    const healthy = await client.ping();
    expect(healthy).toBe(false);
  });

  test("throws MemoryError on JSON-RPC error response", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    try {
      await client.write({
        tenantId: "t1",
        category: "fact",
        content: "test",
        source: "nonexistent_tool_trigger",
      });
      // The mock returns success for memory_capture, so let's test error path differently
    } catch {
      // Expected
    }

    // Test with an unknown tool by manipulating response
    const originalCapture = responseMap.memory_capture;
    delete responseMap.memory_capture;

    try {
      await client.write({
        tenantId: "t1",
        category: "fact",
        content: "test",
        source: "test",
      });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect((error as MemoryError).message).toContain("error");
    } finally {
      responseMap.memory_capture = originalCapture;
    }
  });

  test("includes tenantId in all write operations", async () => {
    const client = new GBrainMcpClient({ endpoint: baseUrl });
    await client.write({
      tenantId: "tenant-xyz",
      category: "decision",
      content: "use postgres",
      source: "meeting",
      metadata: { confidence: 0.9 },
    });

    expect(lastRequest!.arguments.tenantId).toBe("tenant-xyz");
    expect(lastRequest!.arguments.metadata).toEqual({ confidence: 0.9 });
  });
});
