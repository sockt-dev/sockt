import type { Sandbox, SandboxConfig, SandboxInstance, ExecResult } from "@sockt/types";
import { SandboxError } from "@sockt/types";
import type { DockerSandboxConfig } from "../types.ts";
import { getVolumePath } from "./volume-manager.ts";

export class DockerSandbox implements Sandbox {
  private readonly socketPath: string;
  private readonly networkName: string;
  private readonly defaultImage: string;
  private readonly volumeBasePath: string;

  constructor(config: DockerSandboxConfig = {}) {
    this.socketPath = config.socketPath ?? "/var/run/docker.sock";
    this.networkName = config.networkName ?? "sockt-agents";
    this.defaultImage = config.defaultImage ?? "sockt-agent:latest";
    this.volumeBasePath = config.volumeBasePath ?? "/var/sockt/volumes";
  }

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const volumePath = getVolumePath(this.volumeBasePath, config.agentId);

    const body = {
      Image: config.image || this.defaultImage,
      Labels: { "sockt.agent": config.agentId, "sockt.tenant": config.tenantId },
      Env: Object.entries(config.envVars ?? {}).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Binds: [`${volumePath}:/workspace:rw`, ...(config.volumeMounts ?? [])],
        Memory: (config.memoryLimitMb ?? 512) * 1024 * 1024,
        NanoCpus: (config.cpuLimit ?? 1) * 1_000_000_000,
        NetworkMode: this.networkName,
      },
    };

    const createResp = await this.dockerFetch<{ Id: string }>("/containers/create", "POST", body);
    await this.dockerFetch(`/containers/${createResp.Id}/start`, "POST");

    return {
      id: createResp.Id,
      agentId: config.agentId,
      status: "running",
      volumePath,
      createdAt: new Date().toISOString(),
    };
  }

  async exec(instanceId: string, command: string[]): Promise<ExecResult> {
    const execCreate = await this.dockerFetch<{ Id: string }>(
      `/containers/${instanceId}/exec`,
      "POST",
      { Cmd: command, AttachStdout: true, AttachStderr: true },
    );

    const rawOutput = await this.dockerFetchRaw(`/exec/${execCreate.Id}/start`, "POST", { Detach: false, Tty: false });
    const inspect = await this.dockerFetch<{ ExitCode: number }>(`/exec/${execCreate.Id}/json`, "GET");

    return {
      exitCode: inspect.ExitCode,
      stdout: rawOutput.stdout,
      stderr: rawOutput.stderr,
    };
  }

  async destroy(instanceId: string): Promise<void> {
    await this.dockerFetch(`/containers/${instanceId}/stop`, "POST").catch(() => {});
    await this.dockerFetch(`/containers/${instanceId}`, "DELETE");
  }

  async listRunning(): Promise<SandboxInstance[]> {
    const filters = JSON.stringify({ label: ["sockt.agent"], status: ["running"] });
    const containers = await this.dockerFetch<Array<{
      Id: string;
      Labels: Record<string, string>;
      Created: number;
      Mounts: Array<{ Source: string }>;
    }>>(`/containers/json?filters=${encodeURIComponent(filters)}`, "GET");

    return containers.map((c) => ({
      id: c.Id,
      agentId: c.Labels["sockt.agent"] ?? "",
      status: "running" as const,
      volumePath: c.Mounts[0]?.Source ?? "",
      createdAt: new Date(c.Created * 1000).toISOString(),
    }));
  }

  getVolumePath(instanceId: string): string {
    return getVolumePath(this.volumeBasePath, instanceId);
  }

  private async dockerFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
    const resp = await fetch(`http://localhost${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      unix: this.socketPath,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new SandboxError(
        `Docker API error: ${resp.status} ${method} ${path}`,
        { status: resp.status, body: text },
      );
    }

    if (resp.headers.get("content-type")?.includes("json")) {
      return (await resp.json()) as T;
    }
    return undefined as T;
  }

  private async dockerFetchRaw(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<{ stdout: string; stderr: string }> {
    const resp = await fetch(`http://localhost${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      unix: this.socketPath,
    });

    if (!resp.ok) {
      throw new SandboxError(`Docker exec error: ${resp.status}`, { path });
    }

    const raw = await resp.text();
    return { stdout: raw, stderr: "" };
  }
}
