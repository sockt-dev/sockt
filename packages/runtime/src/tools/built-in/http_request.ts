import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

export const httpRequestDefinition: ToolDefinition = {
  name: "http_request",
  description: "Make an HTTP request to an external API or URL. Useful for integrations with HubSpot, Linear, GitHub, Sentry, etc.",
  parameters: {
    type: "object",
    properties: {
      url:     { type: "string", description: "Full URL to request" },
      method:  { type: "string", description: "HTTP method: GET | POST | PUT | PATCH | DELETE (default GET)" },
      headers: { type: "object", description: "HTTP headers as key/value pairs" },
      body:    { type: "string", description: "Request body (for POST/PUT/PATCH)" },
    },
    required: ["url"],
  },
};

const BLOCKED = ["169.254.", "127.", "0.0.0.0", "::1", "localhost"];

export const httpRequestHandler: ToolHandler = async (args) => {
  const url    = String(args.url ?? "");
  const method = String(args.method ?? "GET").toUpperCase();
  const headers = (args.headers ?? {}) as Record<string, string>;
  const body   = args.body != null ? String(args.body) : undefined;

  // Basic SSRF guard
  const host = new URL(url).hostname;
  if (BLOCKED.some(b => host.startsWith(b) || host === "localhost")) {
    throw new Error(`Blocked: internal address '${host}' is not allowed`);
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body && method !== "GET" ? body : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }

  return {
    status: res.status,
    ok: res.ok,
    body: json ?? text,
  };
};
