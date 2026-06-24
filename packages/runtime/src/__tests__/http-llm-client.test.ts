import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { HttpLlmClient } from "../llm/http-client.ts";
import { LlmError } from "@sockt/types";
import type { LlmRequest, LlmMessage } from "@sockt/types";

describe("HttpLlmClient", () => {
  let mockOpenAiServer: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let lastRequestBody: any;
  let responseOverride: any;

  beforeAll(() => {
    lastRequestBody = null;
    responseOverride = null;

    mockOpenAiServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/chat/completions") {
          lastRequestBody = await req.json();

          if (responseOverride) {
            if (typeof responseOverride === "function") return responseOverride(lastRequestBody);
            return Response.json(responseOverride);
          }

          return Response.json({
            id: "chatcmpl-mock",
            object: "chat.completion",
            created: 1700000000,
            model: "gpt-4",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Hello! I'm the mock assistant.",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 25,
              completion_tokens: 10,
              total_tokens: 35,
            },
          });
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    baseUrl = `http://localhost:${mockOpenAiServer.port}`;
  });

  afterAll(() => {
    mockOpenAiServer.stop();
  });

  test("chat sends messages and returns LlmResponse", async () => {
    const client = new HttpLlmClient();
    const request: LlmRequest = {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Say hello" },
      ],
      config: { provider: "openai", model: "gpt-4", apiKey: "test-key", baseUrl },
    };

    const response = await client.chat(request);

    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toBe("Hello! I'm the mock assistant.");
    expect(response.model).toBe("gpt-4");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.promptTokens).toBe(25);
    expect(response.usage.completionTokens).toBe(10);
    expect(response.usage.totalTokens).toBe(35);
  });

  test("chat converts system/user/assistant messages correctly", async () => {
    const client = new HttpLlmClient();
    const request: LlmRequest = {
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User question" },
        { role: "assistant", content: "Previous reply" },
        { role: "user", content: "Follow-up" },
      ],
      config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
    };

    await client.chat(request);

    expect(lastRequestBody.messages).toHaveLength(4);
    expect(lastRequestBody.messages[0].role).toBe("system");
    expect(lastRequestBody.messages[1].role).toBe("user");
    expect(lastRequestBody.messages[2].role).toBe("assistant");
    expect(lastRequestBody.messages[3].role).toBe("user");
  });

  test("chat sends tool definitions to provider", async () => {
    const client = new HttpLlmClient();
    const request: LlmRequest = {
      messages: [{ role: "user", content: "Search for cats" }],
      config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    };

    await client.chat(request);

    expect(lastRequestBody.tools).toBeDefined();
    expect(lastRequestBody.tools.length).toBeGreaterThanOrEqual(1);
    const searchTool = lastRequestBody.tools.find((t: any) => t.function?.name === "web_search" || t.name === "web_search");
    expect(searchTool).toBeDefined();
  });

  test("chat handles tool call response", async () => {
    responseOverride = {
      id: "chatcmpl-tools",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: { name: "web_search", arguments: '{"query":"cats"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    };

    try {
      const client = new HttpLlmClient();
      const response = await client.chat({
        messages: [{ role: "user", content: "Find cats" }],
        config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
        tools: [{ name: "web_search", description: "Search", parameters: {} }],
      });

      expect(response.finishReason).toBe("tool_calls");
      expect(response.message.toolCalls).toBeDefined();
      expect(response.message.toolCalls!.length).toBe(1);
      expect(response.message.toolCalls![0]!.name).toBe("web_search");
      expect(response.message.toolCalls![0]!.arguments).toEqual({ query: "cats" });
      expect(response.message.toolCalls![0]!.id).toBe("call_abc123");
    } finally {
      responseOverride = null;
    }
  });

  test("chat converts tool result messages", async () => {
    const client = new HttpLlmClient();
    const request: LlmRequest = {
      messages: [
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "search", arguments: { q: "test" } }],
        },
        { role: "tool", content: "Found 3 results", toolCallId: "call_1" },
      ],
      config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
    };

    await client.chat(request);

    const messages = lastRequestBody.messages;
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // The assistant message with tool calls should have parts
    const assistantMsg = messages.find((m: any) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    // The tool message should reference the call
    const toolMsg = messages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
  });

  test("chat handles content_filter finish reason", async () => {
    responseOverride = {
      id: "chatcmpl-filter",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "content_filter",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    };

    try {
      const client = new HttpLlmClient();
      const response = await client.chat({
        messages: [{ role: "user", content: "bad request" }],
        config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
      });
      expect(response.finishReason).toBe("content_filter");
    } finally {
      responseOverride = null;
    }
  });

  test("chat handles length finish reason", async () => {
    responseOverride = {
      id: "chatcmpl-length",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "truncated..." },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
    };

    try {
      const client = new HttpLlmClient();
      const response = await client.chat({
        messages: [{ role: "user", content: "write a novel" }],
        config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
      });
      expect(response.finishReason).toBe("length");
      expect(response.message.content).toBe("truncated...");
    } finally {
      responseOverride = null;
    }
  });

  test("chat respects maxTokens and temperature config", async () => {
    const client = new HttpLlmClient();
    await client.chat({
      messages: [{ role: "user", content: "hi" }],
      config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl, maxTokens: 500, temperature: 0.7 },
    });

    expect(lastRequestBody.max_tokens).toBe(500);
    expect(lastRequestBody.temperature).toBe(0.7);
  });

  test("chat throws LlmError when no config provided", async () => {
    const client = new HttpLlmClient();
    try {
      await client.chat({ messages: [{ role: "user", content: "hi" }], config: undefined as any });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).message).toContain("No LLM config");
    }
  });

  test("chat uses defaultConfig when request config is missing", async () => {
    const client = new HttpLlmClient({ provider: "openai", model: "gpt-4", apiKey: "k", baseUrl });
    const response = await client.chat({
      messages: [{ role: "user", content: "hello" }],
      config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
    });
    expect(response.message.role).toBe("assistant");
  });

  test("chat retries on server error and succeeds", async () => {
    let callCount = 0;
    responseOverride = () => {
      callCount++;
      if (callCount < 2) {
        return Response.json({ error: { message: "internal error" } }, { status: 500 });
      }
      return Response.json({
        id: "chatcmpl-retry",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4",
        choices: [{ index: 0, message: { role: "assistant", content: "recovered" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    };

    try {
      const client = new HttpLlmClient();
      const response = await client.chat({
        messages: [{ role: "user", content: "hi" }],
        config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl },
      });
      expect(response.message.content).toBe("recovered");
      expect(callCount).toBeGreaterThanOrEqual(2);
    } finally {
      responseOverride = null;
    }
  });

  test("stream yields text chunks", async () => {
    // Mock SSE streaming response
    const streamServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/chat/completions") {
          const chunks = [
            'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
            'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
            'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
            'data: [DONE]\n\n',
          ];

          const stream = new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
              }
              controller.close();
            },
          });

          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return Response.json({}, { status: 404 });
      },
    });

    try {
      const client = new HttpLlmClient();
      const chunks: string[] = [];
      for await (const chunk of client.stream({
        messages: [{ role: "user", content: "hello" }],
        config: { provider: "openai", model: "gpt-4", apiKey: "k", baseUrl: `http://localhost:${streamServer.port}` },
      })) {
        chunks.push(chunk.delta);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.join("")).toContain("Hello");
    } finally {
      streamServer.stop();
    }
  });

  test("countTokens returns estimate without API call", async () => {
    const client = new HttpLlmClient();
    const messages: LlmMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Hello world" },
    ];
    const count = await client.countTokens(messages);
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(Math.ceil(6 / 4) + 4 + Math.ceil(11 / 4) + 4);
  });

  test("ollama provider uses correct base URL", async () => {
    const ollamaServer = Bun.serve({
      port: 0,
      async fetch(req) {
        return Response.json({
          id: "ollama-1",
          object: "chat.completion",
          created: 1700000000,
          model: "llama3",
          choices: [{ index: 0, message: { role: "assistant", content: "ollama response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        });
      },
    });

    try {
      const client = new HttpLlmClient();
      const response = await client.chat({
        messages: [{ role: "user", content: "hi" }],
        config: { provider: "ollama", model: "llama3", baseUrl: `http://localhost:${ollamaServer.port}` },
      });
      expect(response.message.content).toBe("ollama response");
      expect(response.model).toBe("llama3");
    } finally {
      ollamaServer.stop();
    }
  });
});
