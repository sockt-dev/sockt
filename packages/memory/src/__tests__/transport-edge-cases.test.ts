import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { McpTransport } from "../gbrain/transport.ts";
import { buildJsonRpcRequest } from "../gbrain/mcp-tools.ts";
import { MemoryError } from "@sockt/types";

describe("McpTransport edge cases", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let handler: (req: Request) => Response | Promise<Response>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) { return handler(req); },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => { server.stop(); });

  test("throws MemoryError on connection refused", async () => {
    const transport = new McpTransport({
      endpoint: "http://127.0.0.1:1",
      retries: 0,
      timeoutMs: 1000,
    });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
    }
  });

  test("throws MemoryError on malformed JSON response", async () => {
    handler = () => new Response("not json at all", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
    }
  });

  test("retries exactly the configured number of times on 503", async () => {
    let calls = 0;
    handler = () => { calls++; return new Response("unavailable", { status: 503 }); };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 2, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      // initial attempt + 2 retries = 3 total calls
      expect(calls).toBe(3);
    }
  });

  test("does NOT retry on 401 Unauthorized", async () => {
    let calls = 0;
    handler = () => { calls++; return new Response("unauthorized", { status: 401 }); };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect(calls).toBe(1);
    }
  });

  test("does NOT retry on 403 Forbidden", async () => {
    let calls = 0;
    handler = () => { calls++; return new Response("forbidden", { status: 403 }); };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect(calls).toBe(1);
    }
  });

  test("does NOT retry on 404 Not Found", async () => {
    let calls = 0;
    handler = () => { calls++; return new Response("not found", { status: 404 }); };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect(calls).toBe(1);
    }
  });

  test("retries on 502 Bad Gateway", async () => {
    let calls = 0;
    handler = () => {
      calls++;
      if (calls < 3) return new Response("bad gateway", { status: 502 });
      return Response.json({ jsonrpc: "2.0", id: "x", result: { content: [{ type: "text", text: "{}" }] } });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });
    const response = await transport.send(buildJsonRpcRequest("test", {}));

    expect(calls).toBe(3);
    expect(response.result).toBeDefined();
  });

  test("handles HTML error page on 200 (invalid JSON body)", async () => {
    handler = () => new Response("<html>Server Error</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
    }
  });

  test("handles concurrent requests independently", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    handler = async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await Bun.sleep(20);
      concurrentCount--;
      return Response.json({
        jsonrpc: "2.0",
        id: "x",
        result: { content: [{ type: "text", text: '{"ok":true}' }] },
      });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0, timeoutMs: 5000 });
    const requests = Array.from({ length: 5 }, (_, i) =>
      transport.send(buildJsonRpcRequest(`tool_${i}`, {}))
    );

    const results = await Promise.all(requests);
    expect(results).toHaveLength(5);
    results.forEach((r) => expect(r.result).toBeDefined());
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  test("preserves request body structure", async () => {
    let capturedBody: unknown;
    handler = async (req) => {
      capturedBody = await req.json();
      return Response.json({
        jsonrpc: "2.0",
        id: "x",
        result: { content: [{ type: "text", text: "{}" }] },
      });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0 });
    const request = buildJsonRpcRequest("my_tool", { foo: "bar", nested: { a: 1 } });
    await transport.send(request);

    const body = capturedBody as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect((body.params as Record<string, unknown>).name).toBe("my_tool");
    expect((body.params as Record<string, unknown>).arguments).toEqual({ foo: "bar", nested: { a: 1 } });
    expect(typeof body.id).toBe("string");
    expect((body.id as string).length).toBeGreaterThan(0);
  });

  test("MemoryError includes tool name in context", async () => {
    handler = () => new Response("bad", { status: 400 });

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0 });

    try {
      await transport.send(buildJsonRpcRequest("important_tool", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      const memErr = error as MemoryError;
      expect(memErr.context?.tool).toBe("important_tool");
    }
  });

  test("timeout fires before retry exhaustion", async () => {
    handler = async () => {
      await Bun.sleep(2000);
      return Response.json({ jsonrpc: "2.0", id: "x", result: { content: [] } });
    };

    const start = Date.now();
    const transport = new McpTransport({ endpoint: baseUrl, retries: 0, timeoutMs: 50 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      const elapsed = Date.now() - start;
      expect(error).toBeInstanceOf(MemoryError);
      expect(elapsed).toBeLessThan(500);
    }
  });

  test("retries with increasing backoff on repeated 500s", async () => {
    const timestamps: number[] = [];
    handler = () => {
      timestamps.push(Date.now());
      return new Response("error", { status: 500 });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 2, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
    } catch {
      // Expected to fail
    }

    expect(timestamps).toHaveLength(3);
    const gap1 = timestamps[1]! - timestamps[0]!;
    const gap2 = timestamps[2]! - timestamps[1]!;
    // Second gap should be roughly 2x the first (exponential)
    // Allow generous tolerance for scheduling jitter
    expect(gap1).toBeGreaterThanOrEqual(80);
    expect(gap2).toBeGreaterThanOrEqual(160);
    expect(gap2).toBeGreaterThan(gap1);
  });
});
