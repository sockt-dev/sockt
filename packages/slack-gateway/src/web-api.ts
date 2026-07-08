import type { SlackChannel } from "./types.ts";

const SLACK_API_BASE = "https://slack.com/api";

export class SlackApiError extends Error {
  constructor(method: string, public readonly slackError: string) {
    super(`Slack API error on ${method}: ${slackError}`);
  }
}

async function callSlackApi<T>(method: string, token: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    throw new SlackApiError(method, json.error ?? "unknown_error");
  }
  return json;
}

/** apps.connections.open — exchanges an app-level token for a one-time Socket Mode WSS URL. */
export async function openSocketModeConnection(appToken: string): Promise<string> {
  const result = await callSlackApi<{ url: string }>("apps.connections.open", appToken);
  return result.url;
}

/** chat.postMessage — sends a message, optionally threaded. Returns the message ts (used as message id). */
export async function postMessage(
  botToken: string,
  params: { channel: string; text: string; thread_ts?: string },
): Promise<string> {
  const result = await callSlackApi<{ ts: string }>("chat.postMessage", botToken, params);
  return result.ts;
}

/** conversations.list — channels the bot can see. */
export async function listConversations(botToken: string): Promise<SlackChannel[]> {
  const result = await callSlackApi<{ channels: SlackChannel[] }>("conversations.list", botToken, {
    types: "public_channel,private_channel,im,mpim",
    limit: 200,
  });
  return result.channels;
}
