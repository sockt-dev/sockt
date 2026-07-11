import type { ChannelGateway, ChannelInfo, InboundMessage, OutboundMessage } from "@sockt/types";
import { openSocketModeConnection, postMessage, updateMessage, listConversations } from "./web-api.ts";
import type { SlackEventsApiEnvelope, SlackMessageEvent, SlackInteractiveFrame, SlackInteractionPayload } from "./types.ts";

export interface SlackChannelGatewayConfig {
  appToken: string;
  botToken: string;
  tenantId: string;
  maxBackoffMs?: number;
}

/**
 * ChannelGateway implementation backed by Slack's Socket Mode API.
 * Opens an outbound WebSocket to Slack (no public HTTP endpoint required),
 * receives message/app_mention events, and converts them to InboundMessage.
 * Outbound replies go through the Web API (chat.postMessage) directly —
 * Socket Mode is receive-only, sending never needs the socket.
 */
const SEEN_EVENT_CAP = 500;

export class SlackChannelGateway implements ChannelGateway {
  private ws: WebSocket | null = null;
  private handler: ((message: InboundMessage) => Promise<void>) | null = null;
  private interactionHandler: ((payload: SlackInteractionPayload) => Promise<void>) | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private readonly maxBackoffMs: number;
  // Dedupes on "channel:ts". Fixes the dominant defect from the 2026-07-11
  // eval pass (~17/20 rows got 2 tasks per human send): a workspace
  // subscribed to both `message.channels` and `app_mentions:read` gets TWO
  // separate events for one @mention message (a "message" event and an
  // "app_mention" event), both carrying the same `ts`. Slack's at-least-once
  // redelivery on a slow ack would produce the same shape. A bounded FIFO,
  // not a Set with no cap — this process runs indefinitely and unbounded
  // growth here would be a slow memory leak.
  private readonly seenEventKeys = new Set<string>();
  private readonly seenEventOrder: string[] = [];

  constructor(private readonly config: SlackChannelGatewayConfig) {
    this.maxBackoffMs = config.maxBackoffMs ?? 30_000;
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.handler = handler;
    this.connect().catch((err) => {
      console.error("[slack-gateway] initial connection failed:", err);
    });
  }

  /** Fires on Block Kit interactions (e.g. an approve/deny button click).
   * Slack-specific — not part of the generic ChannelGateway interface. */
  onInteraction(handler: (payload: SlackInteractionPayload) => Promise<void>): void {
    this.interactionHandler = handler;
  }

  async send(message: OutboundMessage): Promise<string> {
    return postMessage(this.config.botToken, {
      channel: message.channelId,
      text: message.content,
      thread_ts: message.threadId,
    });
  }

  /** Posts a message with Block Kit blocks (e.g. approve/deny buttons).
   * `text` is the fallback shown in notifications/unsupported clients. */
  async sendBlocks(channelId: string, threadId: string | null, text: string, blocks: unknown[]): Promise<string> {
    return postMessage(this.config.botToken, {
      channel: channelId,
      text,
      thread_ts: threadId ?? undefined,
      blocks,
    });
  }

  /** Edits a previously-sent message in place, e.g. to swap buttons for a
   * "decided" state once someone clicks approve/deny. */
  async updateBlocks(channelId: string, ts: string, text: string, blocks?: unknown[]): Promise<void> {
    await updateMessage(this.config.botToken, { channel: channelId, ts, text, blocks });
  }

  async listChannels(_tenantId: string): Promise<ChannelInfo[]> {
    const channels = await listConversations(this.config.botToken);
    return channels.map((c) => ({
      id: c.id,
      platform: "slack" as const,
      name: c.name,
      tenantId: this.config.tenantId,
    }));
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const url = await openSocketModeConnection(this.config.appToken);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      this.handleFrame(String(event.data)).catch((err) => {
        console.error("[slack-gateway] error handling frame:", err);
      });
    });

    ws.addEventListener("close", () => {
      if (this.stopped) return;
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (err) => {
      console.error("[slack-gateway] websocket error:", err);
    });

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        this.backoffMs = 1000; // reset backoff on a clean connect
        console.log("[slack-gateway] connected to Slack Socket Mode");
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("websocket failed to open")));
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    console.warn(`[slack-gateway] disconnected — reconnecting in ${delay}ms`);
    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[slack-gateway] reconnect failed:", err);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private async handleFrame(raw: string): Promise<void> {
    const frame = JSON.parse(raw) as { type: string; [key: string]: unknown };

    if (frame.type === "hello") return;

    if (frame.type === "disconnect") {
      // Slack asks us to reconnect (e.g. periodic connection rotation).
      // The socket will also emit "close" right after this, which triggers scheduleReconnect.
      return;
    }

    if (frame.type === "events_api") {
      const envelope = frame as unknown as SlackEventsApiEnvelope;

      // Ack within 3s or Slack will redeliver the event.
      this.ws?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));

      const inbound = this.toInboundMessage(envelope.payload.event);
      if (inbound && this.handler) {
        await this.handler(inbound);
      }
    }

    if (frame.type === "interactive") {
      const envelope = frame as unknown as SlackInteractiveFrame;

      // Same 3s ack deadline as events_api.
      this.ws?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));

      if (this.interactionHandler) {
        await this.interactionHandler(envelope.payload);
      }
    }
  }

  private toInboundMessage(event: SlackMessageEvent): InboundMessage | null {
    if (event.bot_id) return null; // never react to bot messages (avoids reply loops)
    if (event.subtype && event.subtype !== "") return null; // skip edits/deletes/joins/etc
    // Defensive second check: a message_changed (edit) envelope nests the
    // actual content under `message`/`previous_message` regardless of what
    // subtype string (if any) Slack sent at the top level. The 2026-07-11
    // eval pass (M2 probe) found an edit still created a task despite the
    // subtype filter above — root cause was never confirmed, so this
    // mitigates by content shape rather than assuming subtype is reliable.
    if (event.message || event.previous_message) return null;
    if (!event.user || !event.text) return null;
    if (this.isDuplicateEvent(event.channel, event.ts)) return null;

    return {
      id: event.ts,
      platform: "slack",
      channelId: event.channel,
      threadId: event.thread_ts ?? event.ts, // reply threaded under the origin message
      userId: event.user,
      content: event.text,
      attachments: (event.files ?? [])
        .filter((f) => f.url_private)
        .map((f) => ({ type: "file" as const, url: f.url_private!, name: f.name, mimeType: f.mimetype })),
      mentions: [],
      timestamp: slackTsToIso(event.ts),
      tenantId: this.config.tenantId,
    };
  }
  /** True (and records the key) on first sight; true again on every repeat.
   * Checked, not just recorded, so callers get a real yes/no rather than
   * having to compare set size before/after. */
  private isDuplicateEvent(channel: string, ts: string): boolean {
    const key = `${channel}:${ts}`;
    if (this.seenEventKeys.has(key)) return true;

    this.seenEventKeys.add(key);
    this.seenEventOrder.push(key);
    if (this.seenEventOrder.length > SEEN_EVENT_CAP) {
      const oldest = this.seenEventOrder.shift();
      if (oldest) this.seenEventKeys.delete(oldest);
    }
    return false;
  }
}

function slackTsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}
