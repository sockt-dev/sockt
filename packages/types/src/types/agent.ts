import type { LlmConfig } from "./llm.ts";

export const AgentRole = {
  Architect: "architect",
  Worker: "worker",
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];
export const AGENT_ROLE_VALUES = Object.values(AgentRole) as [AgentRole, ...AgentRole[]];

export interface AgentConfig {
  id: string;
  tenantId: string;
  name: string;
  role: AgentRole;
  llmConfig: LlmConfig;
  systemPrompt: string;
  tools: string[];
  department?: string;
  maxConcurrentTasks?: number;
}
