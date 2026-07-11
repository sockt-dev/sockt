import type { AgentConfig, AgentRole, InboundMessage } from "@sockt/types";
import type { AgentRegistry } from "../registry/agent-registry.ts";

type AgentResolver = () => AgentConfig | undefined;

export class MessageRouter {
  private readonly registry: AgentRegistry;
  private channelMappings = new Map<string, AgentResolver>();
  private contentRules: [RegExp, AgentResolver][] = [];

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  route(message: InboundMessage): AgentConfig[] {
    const matched: AgentConfig[] = [];

    for (const mention of message.mentions) {
      const agent = this.registry.getByName(mention);
      if (agent) matched.push(agent);
    }

    if (matched.length === 0) {
      const resolveChannel = this.channelMappings.get(message.channelId);
      const agent = resolveChannel?.();
      if (agent) matched.push(agent);
    }

    if (matched.length === 0) {
      for (const [pattern, resolve] of this.contentRules) {
        pattern.lastIndex = 0;
        if (pattern.test(message.content)) {
          const agent = resolve();
          if (agent) matched.push(agent);
          break;
        }
      }
    }

    return matched;
  }

  addChannelMapping(channelId: string, agentId: string): void {
    this.channelMappings.set(channelId, () => this.registry.get(agentId));
  }

  addContentRule(pattern: RegExp, agentId: string): void {
    this.contentRules.push([pattern, () => this.registry.get(agentId)]);
  }

  addChannelRoute(channelId: string, department: string, role: AgentRole): void {
    this.channelMappings.set(channelId, () => this.registry.getByDepartmentAndRole(department, role));
  }

  addContentRoute(pattern: RegExp, department: string, role: AgentRole): void {
    this.contentRules.push([pattern, () => this.registry.getByDepartmentAndRole(department, role)]);
  }
}
