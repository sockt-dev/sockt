// Minimal Slack Socket Mode / Events API payload shapes — only the fields
// this gateway actually reads. Not a full Slack API type surface.

export interface SlackMessageEvent {
  type: "message" | "app_mention";
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  files?: { url_private?: string; name?: string; mimetype?: string }[];
}

export interface SlackEventsApiEnvelope {
  type: "events_api";
  envelope_id: string;
  payload: {
    team_id: string;
    event: SlackMessageEvent;
  };
  accepts_response_payload: boolean;
}

export interface SlackHelloFrame {
  type: "hello";
  num_connections: number;
}

export interface SlackDisconnectFrame {
  type: "disconnect";
  reason: string;
}

export type SlackSocketFrame = SlackEventsApiEnvelope | SlackHelloFrame | SlackDisconnectFrame | { type: string };

export interface SlackChannel {
  id: string;
  name: string;
  is_channel?: boolean;
  is_private?: boolean;
}
