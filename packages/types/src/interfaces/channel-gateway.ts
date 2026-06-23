import type { InboundMessage, OutboundMessage } from "../schemas/channel.schema.ts";
import type { ChannelInfo } from "../types/channel.ts";

export interface ChannelGateway {
  send(message: OutboundMessage): Promise<string>;
  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
  listChannels(tenantId: string): Promise<ChannelInfo[]>;
  disconnect(): Promise<void>;
}
