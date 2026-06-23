export interface SandboxConfig {
  image: string;
  agentId: string;
  tenantId: string;
  volumeMounts?: string[];
  envVars?: Record<string, string>;
  memoryLimitMb?: number;
  cpuLimit?: number;
}

export interface SandboxInstance {
  id: string;
  agentId: string;
  status: "running" | "stopped" | "error";
  volumePath: string;
  createdAt: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
