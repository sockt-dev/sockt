import { z } from "zod";
import { PLATFORM_VALUES } from "../types/channel.ts";

const ATTACHMENT_TYPE_VALUES = ["file", "image", "link"] as const;

export const AttachmentSchema = z.object({
  type: z.enum(ATTACHMENT_TYPE_VALUES),
  url: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const InboundMessageSchema = z.object({
  id: z.string(),
  platform: z.enum(PLATFORM_VALUES),
  channelId: z.string(),
  threadId: z.string().optional(),
  userId: z.string(),
  content: z.string(),
  attachments: z.array(AttachmentSchema),
  mentions: z.array(z.string()),
  timestamp: z.string().datetime(),
  tenantId: z.string(),
});
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

export const OutboundMessageSchema = z.object({
  platform: z.enum(PLATFORM_VALUES),
  channelId: z.string(),
  threadId: z.string().optional(),
  content: z.string(),
  attachments: z.array(AttachmentSchema).optional(),
  replyToMessageId: z.string().optional(),
  tenantId: z.string(),
});
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
