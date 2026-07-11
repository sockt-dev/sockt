import type { AgentConfig } from "@sockt/types";
import type { AgentRegistry } from "./agent-registry.ts";
import { growthTemplate } from "./templates/growth.ts";
import { productTemplate } from "./templates/product.ts";
import { engOpsTemplate } from "./templates/eng-ops.ts";
import { supportTemplate } from "./templates/support.ts";

// "engops" (no hyphen) to match the runtime's DEPARTMENT env var and the
// skills directory naming (packages/orch/src/registry/skills/engops/) — was
// "eng-ops" here only, a naming mismatch that would have broken routing the
// moment this dead-code template path got wired up. Fixed 2026-07-11.
export type DepartmentTemplate = "growth" | "product" | "engops" | "support";

const TEMPLATE_FACTORIES: Record<DepartmentTemplate, (tenantId: string) => AgentConfig[]> = {
  growth: growthTemplate,
  product: productTemplate,
  engops: engOpsTemplate,
  support: supportTemplate,
};

export class DepartmentManager {
  private readonly registry: AgentRegistry;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  createFromTemplate(template: DepartmentTemplate, tenantId: string): AgentConfig[] {
    const factory = TEMPLATE_FACTORIES[template];
    const agents = factory(tenantId);
    for (const agent of agents) {
      this.registry.register(agent);
    }
    return agents;
  }

  listTemplates(): DepartmentTemplate[] {
    return Object.keys(TEMPLATE_FACTORIES) as DepartmentTemplate[];
  }
}
