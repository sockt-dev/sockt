import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { makeGithubCreateIssueHandler } from "../tools/built-in/github_create_issue.ts";
import { registerBuiltInTools } from "../tools/built-in/index.ts";
import { ToolRegistry } from "../tools/registry.ts";

describe("github_create_issue handler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws instructively when no token is configured", async () => {
    const handler = makeGithubCreateIssueHandler({});
    await expect(handler({ title: "t", body: "b" })).rejects.toThrow(/GITHUB_TOKEN missing/);
  });

  test("throws instructively when no repo is resolvable", async () => {
    const handler = makeGithubCreateIssueHandler({ token: "tok" });
    await expect(handler({ title: "t", body: "b" })).rejects.toThrow(/GITHUB_REPO missing/);
  });

  test("rejects a malformed repo override", async () => {
    const handler = makeGithubCreateIssueHandler({ token: "tok", defaultRepo: "owner/repo" });
    await expect(handler({ title: "t", body: "b", repo: "not-a-valid-repo" })).rejects.toThrow(/not a valid owner\/name/);
  });

  test("requires a non-empty title and body", async () => {
    const handler = makeGithubCreateIssueHandler({ token: "tok", defaultRepo: "owner/repo" });
    await expect(handler({ title: "", body: "b" })).rejects.toThrow();
    await expect(handler({ title: "t", body: "" })).rejects.toThrow();
  });

  test("posts to the GitHub API and returns the created issue", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/owner/repo/issues/42" }), { status: 201 });
    }) as typeof fetch;

    const handler = makeGithubCreateIssueHandler({ token: "tok", defaultRepo: "owner/repo" });
    const result = await handler({ title: "feat: thing", body: "User Story...", labels: ["feat", "p1"] }) as { number: number; url: string; repo: string };

    expect(capturedUrl).toBe("https://api.github.com/repos/owner/repo/issues");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(result.number).toBe(42);
    expect(result.url).toBe("https://github.com/owner/repo/issues/42");
    expect(result.repo).toBe("owner/repo");
  });

  test("throws with status and body text on a non-ok response", async () => {
    globalThis.fetch = (async () => new Response("rate limited", { status: 403, statusText: "Forbidden" })) as typeof fetch;
    const handler = makeGithubCreateIssueHandler({ token: "tok", defaultRepo: "owner/repo" });
    await expect(handler({ title: "t", body: "b" })).rejects.toThrow(/403/);
  });

  test("an explicit repo override wins over the configured default", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ number: 1, html_url: "https://github.com/other/repo/issues/1" }), { status: 201 });
    }) as typeof fetch;

    const handler = makeGithubCreateIssueHandler({ token: "tok", defaultRepo: "owner/repo" });
    await handler({ title: "t", body: "b", repo: "other/repo" });
    expect(capturedUrl).toBe("https://api.github.com/repos/other/repo/issues");
  });
});

describe("registerBuiltInTools — github_create_issue conditional registration", () => {
  test("is not registered when github token/repo are missing", () => {
    const registry = new ToolRegistry();
    registerBuiltInTools(registry, {
      orchUrl: "http://x", tenantId: "t1", agentId: "a1", department: "product",
      currentTaskId: {}, createdByParent: new Map(), createdIdsByParent: new Map(),
    });
    expect(registry.has("github_create_issue")).toBe(false);
  });

  test("is registered when both github token and defaultRepo are set", () => {
    const registry = new ToolRegistry();
    registerBuiltInTools(registry, {
      orchUrl: "http://x", tenantId: "t1", agentId: "a1", department: "product",
      currentTaskId: {}, createdByParent: new Map(), createdIdsByParent: new Map(),
      github: { token: "tok", defaultRepo: "owner/repo" },
    });
    expect(registry.has("github_create_issue")).toBe(true);
  });
});
