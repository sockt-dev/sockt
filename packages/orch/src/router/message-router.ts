import type { AgentConfig, InboundMessage } from "@sockt/types";
import type { AgentRegistry } from "../registry/agent-registry.ts";

export class MessageRouter {
  private readonly registry: AgentRegistry;
  private channelMappings = new Map<string, string>();
  private contentRules: [RegExp, string][] = [];

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
      const channelAgentId = this.channelMappings.get(message.channelId);
      if (channelAgentId) {
        const agent = this.registry.get(channelAgentId);
        if (agent) matched.push(agent);
      }
    }

    if (matched.length === 0) {
      for (const [pattern, agentId] of this.contentRules) {
        pattern.lastIndex = 0;
        if (pattern.test(message.content)) {
          const agent = this.registry.get(agentId);
          if (agent) matched.push(agent);
          break;
        }
      }
    }

    return matched;
  }

  addChannelMapping(channelId: string, agentId: string): void {
    this.channelMappings.set(channelId, agentId);
  }

  addContentRule(pattern: RegExp, agentId: string): void {
    this.contentRules.push([pattern, agentId]);
  }
}
