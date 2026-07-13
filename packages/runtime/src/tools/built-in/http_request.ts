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

// Basic SSRF guard. Blocks loopback, RFC1918 private ranges, link-local
// (including the 169.254.169.254 cloud metadata endpoint), IPv4-mapped and
// link-local/unique-local IPv6, and decimal/hex-encoded IPv4 literals (e.g.
// "http://2130706433/" == "http://127.0.0.1/", which a bare string-prefix
// check on the literal hostname would never catch). This is still just a
// hostname-level check, not a DNS-rebinding defense — it does not resolve
// hostnames before connecting, so a domain name that resolves to a private
// IP at request time is not caught here.
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((p) => p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 127 ||                          // loopback
    a === 10 ||                           // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12
    (a === 192 && b === 168) ||           // 192.168.0.0/16
    (a === 169 && b === 254) ||           // link-local incl. cloud metadata
    a === 0                               // 0.0.0.0/8
  );
}

function decimalOrHexToIPv4(host: string): string | null {
  const isHex = /^0x[0-9a-f]+$/i.test(host);
  const isDecimal = /^\d+$/.test(host);
  if (!isHex && !isDecimal) return null;
  const n = Number(host);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

// `new URL(...).hostname` normalizes an IPv4-mapped IPv6 address like
// "::ffff:127.0.0.1" into hex-group form ("::ffff:7f00:1"), not the dotted
// form — so a plain `host.slice("::ffff:".length)` (dotted-quad-only) check
// silently never matches for any address that went through URL parsing.
function mappedIPv6ToIPv4(host: string): string | null {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1]!;
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".");
}

function isBlockedHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 link-local / unique-local
  if (host.startsWith("::ffff:")) {
    const mapped = mappedIPv6ToIPv4(host);
    if (mapped && isPrivateIPv4(mapped)) return true;
  }
  if (isPrivateIPv4(host)) return true;
  const decoded = decimalOrHexToIPv4(host);
  if (decoded && isPrivateIPv4(decoded)) return true;
  return false;
}

export const httpRequestHandler: ToolHandler = async (args) => {
  const url    = String(args.url ?? "");
  const method = String(args.method ?? "GET").toUpperCase();
  const headers = (args.headers ?? {}) as Record<string, string>;
  const body   = args.body != null ? String(args.body) : undefined;

  const host = new URL(url).hostname;
  if (isBlockedHost(host)) {
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
