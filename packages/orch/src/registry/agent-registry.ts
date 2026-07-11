import type { AgentConfig } from "@sockt/types";

export class AgentRegistry {
  private agents = new Map<string, AgentConfig>();

  constructor(agents?: AgentConfig[]) {
    if (agents) {
      for (const agent of agents) {
        this.register(agent);
      }
    }
  }

  register(agent: AgentConfig): void {
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  getByName(name: string): AgentConfig | undefined {
    const lower = name.toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.name.toLowerCase() === lower) return agent;
    }
    return undefined;
  }

  getByDepartmentAndRole(department: string, role: AgentConfig["role"]): AgentConfig | undefined {
    for (const agent of this.agents.values()) {
      if (agent.department === department && agent.role === role) return agent;
    }
    return undefined;
  }

  listByDepartment(department: string): AgentConfig[] {
    const result: AgentConfig[] = [];
    for (const agent of this.agents.values()) {
      if (agent.department === department) result.push(agent);
    }
    return result;
  }

  listByTenant(tenantId: string): AgentConfig[] {
    const result: AgentConfig[] = [];
    for (const agent of this.agents.values()) {
      if (agent.tenantId === tenantId) result.push(agent);
    }
    return result;
  }

  listAll(): AgentConfig[] {
    return [...this.agents.values()];
  }
}
