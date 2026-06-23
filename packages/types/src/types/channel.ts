export const Platform = {
  Slack: "slack",
  Discord: "discord",
  Teams: "teams",
  Email: "email",
  Webhook: "webhook",
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];
export const PLATFORM_VALUES = Object.values(Platform) as [Platform, ...Platform[]];

export interface Attachment {
  type: "file" | "image" | "link";
  url: string;
  name?: string;
  mimeType?: string;
}

export interface ChannelInfo {
  id: string;
  platform: Platform;
  name: string;
  tenantId: string;
}
