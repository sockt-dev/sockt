import type { AgentConfig } from "@sockt/types";

export function supportTemplate(tenantId: string): AgentConfig[] {
  return [
    {
      id: `${tenantId}-support-architect`,
      tenantId,
      name: "Support Architect",
      role: "architect",
      department: "support",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You are a support operations architect. You triage issues and coordinate responses.",
      tools: ["ticket-manage", "kb-search", "escalation-route"],
    },
    {
      id: `${tenantId}-support-responder`,
      tenantId,
      name: "Support Responder",
      role: "worker",
      department: "support",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You respond to customer support tickets with helpful answers.",
      tools: ["ticket-manage", "kb-search", "response-draft"],
    },
  ];
}
