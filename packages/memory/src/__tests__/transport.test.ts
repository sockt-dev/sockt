import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { McpTransport } from "../gbrain/transport.ts";
import { buildJsonRpcRequest } from "../gbrain/mcp-tools.ts";
import { MemoryError } from "@sockt/types";

describe("McpTransport", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let requestCount: number;
  let handler: (req: Request) => Response | Promise<Response>;

  beforeAll(() => {
    requestCount = 0;
    server = Bun.serve({
      port: 0,
      fetch(req) {
        requestCount++;
        return handler(req);
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("sends request and returns response on 200", async () => {
    handler = () => Response.json({
      jsonrpc: "2.0",
      id: "test",
      result: { content: [{ type: "text", text: '{"ok":true}' }] },
    });

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0 });
    const request = buildJsonRpcRequest("test_tool", { key: "value" });
    const response = await transport.send(request);

    expect(response.result?.content[0]?.text).toBe('{"ok":true}');
  });

  test("retries on 500 and succeeds on next attempt", async () => {
    let calls = 0;
    handler = () => {
      calls++;
      if (calls === 1) return new Response("error", { status: 500 });
      return Response.json({
        jsonrpc: "2.0",
        id: "test",
        result: { content: [{ type: "text", text: '{"ok":true}' }] },
      });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 2, timeoutMs: 5000 });
    const response = await transport.send(buildJsonRpcRequest("test", {}));

    expect(calls).toBe(2);
    expect(response.result?.content[0]?.text).toBe('{"ok":true}');
  });

  test("throws MemoryError after exhausting retries on 500", async () => {
    handler = () => new Response("error", { status: 500 });

    const transport = new McpTransport({ endpoint: baseUrl, retries: 1, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect((error as MemoryError).message).toContain("HTTP 500");
    }
  });

  test("does NOT retry on 400", async () => {
    let calls = 0;
    handler = () => { calls++; return new Response("bad request", { status: 400 }); };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect(calls).toBe(1);
    }
  });

  test("retries on 429", async () => {
    let calls = 0;
    handler = () => {
      calls++;
      if (calls <= 2) return new Response("rate limited", { status: 429 });
      return Response.json({
        jsonrpc: "2.0",
        id: "test",
        result: { content: [{ type: "text", text: '{"ok":true}' }] },
      });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 3, timeoutMs: 5000 });
    const response = await transport.send(buildJsonRpcRequest("test", {}));

    expect(calls).toBe(3);
    expect(response.result).toBeDefined();
  });

  test("throws MemoryError on timeout", async () => {
    handler = async () => {
      await Bun.sleep(500);
      return Response.json({ jsonrpc: "2.0", id: "test", result: { content: [] } });
    };

    const transport = new McpTransport({ endpoint: baseUrl, retries: 0, timeoutMs: 50 });

    try {
      await transport.send(buildJsonRpcRequest("test", {}));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError);
      expect((error as MemoryError).message).toContain("failed");
    }
  });
});
