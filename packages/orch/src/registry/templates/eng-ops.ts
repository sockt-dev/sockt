import type { AgentConfig } from "@sockt/types";

export function engOpsTemplate(tenantId: string): AgentConfig[] {
  return [
    {
      id: `${tenantId}-engops-architect`,
      tenantId,
      name: "Eng-Ops Architect",
      role: "architect",
      department: "eng-ops",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You are an engineering operations architect. You plan deployments, incident responses, and infrastructure.",
      tools: ["deploy-manage", "incident-triage", "infra-query"],
    },
    {
      id: `${tenantId}-engops-deploy`,
      tenantId,
      name: "Deploy Worker",
      role: "worker",
      department: "eng-ops",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You execute deployments and monitor rollouts.",
      tools: ["deploy-manage", "health-check", "rollback"],
    },
  ];
}
