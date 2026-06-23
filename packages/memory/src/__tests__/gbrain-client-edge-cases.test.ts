import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { GBrainMcpClient } from "../gbrain/client.ts";
import { MemoryError } from "@sockt/types";

describe("GBrainMcpClient edge cases", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let responseHandler: (toolName: string, args: Record<string, unknown>) => unknown;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          params: { name: string; arguments: Record<string, unknown> };
        };
        const result = responseHandler(body.params.name, body.params.arguments);

        if (result === null) {
          return Response.json({
            jsonrpc: "2.0",
            id: "test",
            error: { code: -32602, message: "Invalid params" },
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

  afterAll(() => { server.stop(); });

  describe("write()", () => {
    test("handles metadata with nested objects", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { id: "m-1" }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.write({
        tenantId: "t1",
        category: "fact",
        content: "test",
        source: "test",
        metadata: {
          nested: { deep: { value: 42 } },
          array: [1, 2, 3],
          nullVal: null,
        },
      });

      expect(capturedArgs.metadata).toEqual({
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        nullVal: null,
      });
    });

    test("handles content with special characters", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { id: "m-2" }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const specialContent = 'Line 1\nLine 2\tTabbed\r\n"Quoted" & <html>\\escaped\\';
      await client.write({
        tenantId: "t1",
        category: "fact",
        content: specialContent,
        source: "test",
      });

      expect(capturedArgs.content).toBe(specialContent);
    });

    test("handles unicode content", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { id: "m-3" }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const unicodeContent = "用户喜欢咖啡 ☕ — mémoire vive 🧠 العربية";
      await client.write({
        tenantId: "t1",
        category: "preference",
        content: unicodeContent,
        source: "test",
      });

      expect(capturedArgs.content).toBe(unicodeContent);
    });

    test("handles very large content", async () => {
      responseHandler = () => ({ id: "m-large" });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const largeContent = "x".repeat(100_000);
      const id = await client.write({
        tenantId: "t1",
        category: "context",
        content: largeContent,
        source: "test",
      });

      expect(id).toBe("m-large");
    });

    test("sends undefined metadata as undefined (not null)", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { id: "m-4" }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.write({
        tenantId: "t1",
        category: "fact",
        content: "no metadata",
        source: "test",
      });

      expect(capturedArgs.metadata).toBeUndefined();
    });
  });

  describe("search()", () => {
    test("handles empty results array", async () => {
      responseHandler = () => ({ results: [] });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const results = await client.search({ tenantId: "t1", query: "nonexistent" });

      expect(results).toEqual([]);
    });

    test("handles results with optional fields missing", async () => {
      responseHandler = () => ({
        results: [{
          id: "m-1",
          tenantId: "t1",
          category: "fact",
          content: "minimal",
          source: "test",
          createdAt: "2024-01-01T00:00:00Z",
          score: 0.88,
          // no rankSource, no metadata, no embedding
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const results = await client.search({ tenantId: "t1", query: "test" });

      expect(results).toHaveLength(1);
      expect(results[0]!.rankSource).toBe("vector"); // defaults to "vector"
      expect(results[0]!.entry.metadata).toBeUndefined();
      expect(results[0]!.entry.embedding).toBeUndefined();
    });

    test("handles results with embedding arrays", async () => {
      const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
      responseHandler = () => ({
        results: [{
          id: "m-emb",
          tenantId: "t1",
          category: "fact",
          content: "with embedding",
          source: "test",
          createdAt: "2024-01-01T00:00:00Z",
          score: 0.92,
          rankSource: "vector",
          embedding,
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const results = await client.search({ tenantId: "t1", query: "test" });

      expect(results[0]!.entry.embedding).toHaveLength(1536);
    });

    test("maps different rankSource values correctly", async () => {
      responseHandler = () => ({
        results: [
          { id: "m-1", tenantId: "t1", category: "fact", content: "a", source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.9, rankSource: "text" },
          { id: "m-2", tenantId: "t1", category: "fact", content: "b", source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.8, rankSource: "vector" },
          { id: "m-3", tenantId: "t1", category: "fact", content: "c", source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.7, rankSource: "rrf" },
        ],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const results = await client.search({ tenantId: "t1", query: "test" });

      expect(results[0]!.rankSource).toBe("text");
      expect(results[1]!.rankSource).toBe("vector");
      expect(results[2]!.rankSource).toBe("rrf");
    });

    test("passes optional categories filter", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { results: [] }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.search({
        tenantId: "t1",
        query: "test",
        categories: ["fact", "decision"],
      });

      expect(capturedArgs.categories).toEqual(["fact", "decision"]);
    });

    test("handles many results", async () => {
      responseHandler = () => ({
        results: Array.from({ length: 100 }, (_, i) => ({
          id: `m-${i}`,
          tenantId: "t1",
          category: "fact",
          content: `content ${i}`,
          source: "test",
          createdAt: "2024-01-01T00:00:00Z",
          score: 1 - i * 0.01,
          rankSource: "vector",
        })),
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const results = await client.search({ tenantId: "t1", query: "test" });

      expect(results).toHaveLength(100);
      expect(results[0]!.score).toBe(1);
      expect(results[99]!.score).toBeCloseTo(0.01, 5);
    });
  });

  describe("deduplicateCheck()", () => {
    test("returns false for empty results", async () => {
      responseHandler = () => ({ results: [] });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      expect(await client.deduplicateCheck("novel", "t1", 0.92)).toBe(false);
    });

    test("returns true at exact threshold", async () => {
      responseHandler = () => ({
        results: [{
          id: "m-1", tenantId: "t1", category: "fact", content: "x",
          source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.92,
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      expect(await client.deduplicateCheck("x", "t1", 0.92)).toBe(true);
    });

    test("returns false just below threshold", async () => {
      responseHandler = () => ({
        results: [{
          id: "m-1", tenantId: "t1", category: "fact", content: "x",
          source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.9199,
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      expect(await client.deduplicateCheck("x", "t1", 0.92)).toBe(false);
    });

    test("uses threshold 0 (everything is duplicate)", async () => {
      responseHandler = () => ({
        results: [{
          id: "m-1", tenantId: "t1", category: "fact", content: "x",
          source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.01,
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      expect(await client.deduplicateCheck("anything", "t1", 0)).toBe(true);
    });

    test("uses threshold 1.0 (nothing is duplicate unless perfect match)", async () => {
      responseHandler = () => ({
        results: [{
          id: "m-1", tenantId: "t1", category: "fact", content: "x",
          source: "s", createdAt: "2024-01-01T00:00:00Z", score: 0.999,
        }],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      expect(await client.deduplicateCheck("x", "t1", 1.0)).toBe(false);
    });
  });

  describe("listCategories()", () => {
    test("returns empty array when no valid topics", async () => {
      responseHandler = () => ({ topics: ["invalid1", "notacategory", "xyz"] });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const categories = await client.listCategories("t1");
      expect(categories).toEqual([]);
    });

    test("returns all valid categories", async () => {
      responseHandler = () => ({
        topics: ["fact", "decision", "preference", "procedure", "context"],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const categories = await client.listCategories("t1");
      expect(categories).toEqual(["fact", "decision", "preference", "procedure", "context"]);
    });

    test("handles empty topics array", async () => {
      responseHandler = () => ({ topics: [] });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const categories = await client.listCategories("t1");
      expect(categories).toEqual([]);
    });

    test("filters mixed valid and invalid topics", async () => {
      responseHandler = () => ({
        topics: ["fact", "garbage", "preference", "not_real", "context"],
      });

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      const categories = await client.listCategories("t1");
      expect(categories).toEqual(["fact", "preference", "context"]);
    });
  });

  describe("error handling", () => {
    test("throws MemoryError on JSON-RPC error", async () => {
      responseHandler = () => null; // triggers error response

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      try {
        await client.write({ tenantId: "t1", category: "fact", content: "x", source: "s" });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError);
        expect((error as MemoryError).message).toContain("memory_capture");
        expect((error as MemoryError).context?.code).toBe(-32602);
      }
    });

    test("throws MemoryError on empty content array", async () => {
      server.stop();
      const emptyServer = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            jsonrpc: "2.0",
            id: "test",
            result: { content: [] },
          });
        },
      });

      const client = new GBrainMcpClient({ endpoint: `http://localhost:${emptyServer.port}` });
      try {
        await client.write({ tenantId: "t1", category: "fact", content: "x", source: "s" });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError);
        expect((error as MemoryError).message).toContain("empty content");
      } finally {
        emptyServer.stop();
        // Restart main server
        server = Bun.serve({
          port: server.port,
          async fetch(req) {
            const body = (await req.json()) as {
              params: { name: string; arguments: Record<string, unknown> };
            };
            const result = responseHandler(body.params.name, body.params.arguments);
            if (result === null) {
              return Response.json({ jsonrpc: "2.0", id: "test", error: { code: -32602, message: "Invalid params" } });
            }
            return Response.json({ jsonrpc: "2.0", id: "test", result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
          },
        });
      }
    });

    test("throws MemoryError on invalid JSON in content text", async () => {
      server.stop();
      const badJsonServer = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({
            jsonrpc: "2.0",
            id: "test",
            result: { content: [{ type: "text", text: "not valid json{{{" }] },
          });
        },
      });

      const client = new GBrainMcpClient({ endpoint: `http://localhost:${badJsonServer.port}` });
      try {
        await client.search({ tenantId: "t1", query: "test" });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError);
        expect((error as MemoryError).message).toContain("invalid JSON");
      } finally {
        badJsonServer.stop();
        server = Bun.serve({
          port: server.port,
          async fetch(req) {
            const body = (await req.json()) as {
              params: { name: string; arguments: Record<string, unknown> };
            };
            const result = responseHandler(body.params.name, body.params.arguments);
            if (result === null) {
              return Response.json({ jsonrpc: "2.0", id: "test", error: { code: -32602, message: "Invalid params" } });
            }
            return Response.json({ jsonrpc: "2.0", id: "test", result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
          },
        });
      }
    });

    test("MemoryError has correct code field", async () => {
      responseHandler = () => null;

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      try {
        await client.delete("non-existent");
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError);
        expect((error as MemoryError).code).toBe("MEMORY_ERROR");
      }
    });
  });

  describe("tenant isolation", () => {
    test("write scopes to tenant", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { id: "m-1" }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.write({ tenantId: "tenant-A", category: "fact", content: "x", source: "s" });
      expect(capturedArgs.tenantId).toBe("tenant-A");

      await client.write({ tenantId: "tenant-B", category: "fact", content: "x", source: "s" });
      expect(capturedArgs.tenantId).toBe("tenant-B");
    });

    test("search scopes to tenant", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { results: [] }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.search({ tenantId: "tenant-isolated", query: "sensitive" });
      expect(capturedArgs.tenantId).toBe("tenant-isolated");
    });

    test("commit scopes to tenant", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { success: true }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.commit("tenant-commit", "msg");
      expect(capturedArgs.tenantId).toBe("tenant-commit");
    });

    test("listCategories scopes to tenant", async () => {
      let capturedArgs: Record<string, unknown> = {};
      responseHandler = (_, args) => { capturedArgs = args; return { topics: [] }; };

      const client = new GBrainMcpClient({ endpoint: baseUrl });
      await client.listCategories("tenant-cats");
      expect(capturedArgs.tenantId).toBe("tenant-cats");
    });
  });
});
