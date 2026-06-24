import type { AgentConfig } from "@sockt/types";

export function growthTemplate(tenantId: string): AgentConfig[] {
  return [
    {
      id: `${tenantId}-growth-architect`,
      tenantId,
      name: "Growth Architect",
      role: "architect",
      department: "growth",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You are a growth strategy architect. You plan campaigns, A/B tests, and growth experiments.",
      tools: ["analytics-query", "ab-test-create", "content-generate"],
    },
    {
      id: `${tenantId}-growth-content`,
      tenantId,
      name: "Content Writer",
      role: "worker",
      department: "growth",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You write high-converting content for growth campaigns.",
      tools: ["content-generate", "seo-analyze", "publish-draft"],
    },
    {
      id: `${tenantId}-growth-analytics`,
      tenantId,
      name: "Analytics Worker",
      role: "worker",
      department: "growth",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You analyze growth metrics and generate reports.",
      tools: ["analytics-query", "report-generate", "chart-create"],
    },
  ];
}
