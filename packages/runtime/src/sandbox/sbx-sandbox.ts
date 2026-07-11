/**
 * Docker AI Sandbox implementation using the `sbx` CLI.
 * Each sandbox is a microVM with its own Docker daemon, filesystem, and network.
 * Agents can install packages, build images, and modify files without touching the host.
 *
 * Requires: sbx installed + `sbx login` run once.
 * Install: winget install -h Docker.sbx  (Windows)
 *          brew install docker/tap/sbx   (macOS)
 *          apt-get install docker-sbx    (Linux)
 */

import type { Sandbox, SandboxConfig, SandboxInstance, ExecResult } from "@sockt/types";
import { SandboxError } from "@sockt/types";

export class SbxSandbox implements Sandbox {
  private readonly sbxBin: string;
  private readonly defaultImage: string;

  constructor(config: { sbxBin?: string; defaultImage?: string } = {}) {
    this.sbxBin = config.sbxBin ?? "sbx";
    this.defaultImage = config.defaultImage ?? "";
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const name = this.nameFor(config.agentId);

    const args = [
      "run",
      "--name", name,
      "--detach",
    ];

    if (this.defaultImage) {
      args.push("--template", this.defaultImage);
    }

    // Set env vars
    for (const [k, v] of Object.entries(config.envVars ?? {})) {
      args.push("--env", `${k}=${v}`);
    }

    // "shell" agent gives a persistent sandbox we can exec into
    args.push("shell");

    const result = await this.run(args);
    if (result.exitCode !== 0) {
      throw new SandboxError(
        `Failed to create sandbox '${name}': ${result.stderr}`,
        { agentId: config.agentId, stderr: result.stderr },
      );
    }

    return {
      id: name,
      agentId: config.agentId,
      status: "running",
      volumePath: "",
      createdAt: new Date().toISOString(),
    };
  }

  async exec(instanceId: string, command: string[]): Promise<ExecResult> {
    const args = ["exec", instanceId, "--", ...command];
    return this.run(args);
  }

  async destroy(instanceId: string): Promise<void> {
    // Stop first (graceful), then remove
    await this.run(["stop", instanceId]).catch(() => {});
    const result = await this.run(["rm", instanceId]);
    if (result.exitCode !== 0 && !result.stderr.includes("not found")) {
      throw new SandboxError(
        `Failed to destroy sandbox '${instanceId}': ${result.stderr}`,
        { instanceId, stderr: result.stderr },
      );
    }
  }

  async listRunning(): Promise<SandboxInstance[]> {
    const result = await this.run(["ls", "--json"]);
    if (result.exitCode !== 0) return [];

    try {
      const rows = JSON.parse(result.stdout) as Array<{
        name: string;
        status: string;
        created: string;
      }>;
      return rows
        .filter(r => r.status === "running")
        .map(r => ({
          id: r.name,
          agentId: r.name.replace(/^sockt-/, ""),
          status: "running" as const,
          volumePath: "",
          createdAt: r.created,
        }));
    } catch {
      return [];
    }
  }

  getVolumePath(_instanceId: string): string {
    return "";
  }

  private nameFor(agentId: string): string {
    // sbx names: lowercase alphanumeric + hyphens
    return `sockt-${agentId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
  }

  private async run(args: string[]): Promise<ExecResult> {
    const proc = Bun.spawn([this.sbxBin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  }
}

/**
 * Check if the sbx CLI is installed and authenticated. Returns false rather
 * than throwing when sbx isn't on PATH at all — Bun.spawn throws ENOENT
 * synchronously in that case (not just a nonzero exit code), which this used
 * to leave uncaught and crash the caller. Found 2026-07-12 while adding
 * hard-mode exec_code enforcement: a completely absent `sbx` (as opposed to
 * "installed but not logged in") took down the whole handler instead of
 * being treated as "sandbox unavailable".
 */
export async function checkSbxAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["sbx", "ls", "--json"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}
