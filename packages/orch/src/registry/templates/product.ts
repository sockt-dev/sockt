import type { AgentConfig } from "@sockt/types";

export function productTemplate(tenantId: string): AgentConfig[] {
  return [
    {
      id: `${tenantId}-product-architect`,
      tenantId,
      name: "Product Architect",
      role: "architect",
      department: "product",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You are a product strategy architect. You define roadmaps and prioritize features.",
      tools: ["roadmap-manage", "user-research", "spec-write"],
    },
    {
      id: `${tenantId}-product-researcher`,
      tenantId,
      name: "User Researcher",
      role: "worker",
      department: "product",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: "You conduct user research and synthesize insights.",
      tools: ["user-research", "survey-create", "insight-summarize"],
    },
  ];
}
