import type { ChannelGateway, ChannelInfo, InboundMessage, OutboundMessage } from "@sockt/types";
import { openSocketModeConnection, postMessage, listConversations } from "./web-api.ts";
import type { SlackEventsApiEnvelope, SlackMessageEvent } from "./types.ts";

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
export class SlackChannelGateway implements ChannelGateway {
  private ws: WebSocket | null = null;
  private handler: ((message: InboundMessage) => Promise<void>) | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private readonly maxBackoffMs: number;

  constructor(private readonly config: SlackChannelGatewayConfig) {
    this.maxBackoffMs = config.maxBackoffMs ?? 30_000;
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.handler = handler;
    this.connect().catch((err) => {
      console.error("[slack-gateway] initial connection failed:", err);
    });
  }

  async send(message: OutboundMessage): Promise<string> {
    return postMessage(this.config.botToken, {
      channel: message.channelId,
      text: message.content,
      thread_ts: message.threadId,
    });
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
  }

  private toInboundMessage(event: SlackMessageEvent): InboundMessage | null {
    if (event.bot_id) return null; // never react to bot messages (avoids reply loops)
    if (event.subtype && event.subtype !== "") return null; // skip edits/deletes/joins/etc
    if (!event.user || !event.text) return null;

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
}

function slackTsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}
