import type { SandboxConfig, SandboxInstance, ExecResult } from "../types/sandbox.ts";

export interface Sandbox {
  create(config: SandboxConfig): Promise<SandboxInstance>;
  exec(instanceId: string, command: string[]): Promise<ExecResult>;
  destroy(instanceId: string): Promise<void>;
  listRunning(): Promise<SandboxInstance[]>;
  getVolumePath(instanceId: string): string;
}
