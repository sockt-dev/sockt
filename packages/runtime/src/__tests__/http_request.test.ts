import { test, expect, describe, afterEach } from "bun:test";
import { httpRequestHandler } from "../tools/built-in/http_request.ts";

describe("http_request SSRF guard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function neverCalledFetch() {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not have been called — SSRF guard failed to block");
    }) as typeof fetch;
  }

  test("blocks loopback (127.0.0.1)", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://127.0.0.1/admin" })).rejects.toThrow(/Blocked/);
  });

  test("blocks localhost by name", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://localhost:8080/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks the cloud metadata endpoint (169.254.169.254)", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks RFC1918 10.0.0.0/8", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://10.0.0.5:8080/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks RFC1918 172.16.0.0/12", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://172.20.1.1/" })).rejects.toThrow(/Blocked/);
    // 172.15.x.x and 172.32.x.x are outside the /12 range and legitimately public
  });

  test("blocks RFC1918 192.168.0.0/16", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://192.168.1.1/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks a decimal-encoded loopback IP", async () => {
    neverCalledFetch();
    // 2130706433 == 127.0.0.1
    await expect(httpRequestHandler({ url: "http://2130706433/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks a hex-encoded loopback IP", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://0x7f000001/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks IPv6 loopback (::1)", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://[::1]/" })).rejects.toThrow(/Blocked/);
  });

  test("blocks IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", async () => {
    neverCalledFetch();
    await expect(httpRequestHandler({ url: "http://[::ffff:127.0.0.1]/" })).rejects.toThrow(/Blocked/);
  });

  test("allows a public address through", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const result = await httpRequestHandler({ url: "http://93.184.216.34/" }) as { status: number };
    expect(result.status).toBe(200);
  });

  test("172.15.x.x (just outside the 172.16/12 block) is not blocked", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await httpRequestHandler({ url: "http://172.15.0.1/" }) as { status: number };
    expect(result.status).toBe(200);
  });
});
