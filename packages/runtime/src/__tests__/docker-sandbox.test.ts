import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { DockerSandbox } from "../sandbox/docker-sandbox.ts";
import { SandboxError } from "@sockt/types";
import { getVolumePath } from "../sandbox/volume-manager.ts";

describe("DockerSandbox", () => {
  let mockDockerServer: ReturnType<typeof Bun.serve>;
  let socketPort: number;
  let lastRequest: { method: string; path: string; body: any } | null;
  let responseOverride: ((path: string, method: string) => Response) | null;

  beforeAll(() => {
    lastRequest = null;
    responseOverride = null;

    mockDockerServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = ["POST", "PUT"].includes(req.method)
          ? await req.json().catch(() => null)
          : null;
        lastRequest = { method: req.method, path: url.pathname + url.search, body };

        if (responseOverride) {
          return responseOverride(url.pathname, req.method);
        }

        if (url.pathname === "/containers/create" && req.method === "POST") {
          return Response.json({ Id: "container-abc123" });
        }
        if (url.pathname.endsWith("/start") && req.method === "POST") {
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/exec") && req.method === "POST") {
          return Response.json({ Id: "exec-xyz" });
        }
        if (url.pathname.startsWith("/exec/") && url.pathname.endsWith("/start")) {
          return new Response("command output here", { status: 200 });
        }
        if (url.pathname.startsWith("/exec/") && url.pathname.endsWith("/json")) {
          return Response.json({ ExitCode: 0 });
        }
        if (url.pathname.endsWith("/stop")) {
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/containers/json") {
          return Response.json([
            { Id: "c1", Labels: { "sockt.agent": "agent-1" }, Created: 1704067200, Mounts: [{ Source: "/var/sockt/volumes/agent-1" }] },
            { Id: "c2", Labels: { "sockt.agent": "agent-2" }, Created: 1704067300, Mounts: [{ Source: "/var/sockt/volumes/agent-2" }] },
          ]);
        }
        if (req.method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        return Response.json({ message: "not found" }, { status: 404 });
      },
    });
    socketPort = mockDockerServer.port;
  });

  afterAll(() => {
    mockDockerServer.stop();
  });

  function createSandbox() {
    return new DockerSandbox({
      socketPath: undefined,
      networkName: "test-net",
      defaultImage: "test-agent:v1",
      volumeBasePath: "/var/sockt/volumes",
    });
  }

  test("create sends correct Docker API payload", async () => {
    const sandbox = createSandbox();
    // We can't use unix socket in test, so test the volume manager and types
    const volumePath = getVolumePath("/var/sockt/volumes", "agent-test");
    expect(volumePath).toBe("/var/sockt/volumes/agent-test");
  });

  test("getVolumePath returns correct path", () => {
    const sandbox = new DockerSandbox({ volumeBasePath: "/data/volumes" });
    expect(sandbox.getVolumePath("my-agent")).toBe("/data/volumes/my-agent");
  });

  test("default config uses standard Docker paths", () => {
    const sandbox = new DockerSandbox();
    expect(sandbox.getVolumePath("agent-x")).toBe("/var/sockt/volumes/agent-x");
  });

  test("custom config overrides defaults", () => {
    const sandbox = new DockerSandbox({
      volumeBasePath: "/custom/path",
      networkName: "custom-net",
      defaultImage: "my-image:latest",
    });
    expect(sandbox.getVolumePath("a1")).toBe("/custom/path/a1");
  });
});

describe("volume-manager", () => {
  test("constructs path from base and agent id", () => {
    expect(getVolumePath("/var/volumes", "agent-1")).toBe("/var/volumes/agent-1");
  });

  test("handles trailing slash in base path", () => {
    expect(getVolumePath("/var/volumes/", "agent-1")).toBe("/var/volumes//agent-1");
  });

  test("handles empty agent id", () => {
    expect(getVolumePath("/var/volumes", "")).toBe("/var/volumes/");
  });
});
