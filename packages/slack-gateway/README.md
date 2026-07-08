# @sockt/slack-gateway

A `ChannelGateway` implementation (the interface from `@sockt/types`) backed by Slack's Socket Mode API. This is what lets Sockt agents receive and reply to Slack messages without exposing a public HTTP endpoint — the connection is outbound-only, from your orchestrator to Slack.

## Install

```bash
bun add @sockt/slack-gateway
```

## How it works

- **Inbound**: opens a WebSocket to Slack via `apps.connections.open` (Socket Mode), listens for `message` and `app_mention` events, acknowledges each event envelope within Slack's 3-second window, and converts qualifying events into `InboundMessage` (skipping bot messages, edits, and other subtypes to avoid reply loops).
- **Outbound**: replies go through Slack's Web API (`chat.postMessage`) directly — Socket Mode is receive-only, so sending never touches the socket. Replies are threaded under the originating message by default.
- **Reconnect**: on disconnect (Slack rotates Socket Mode connections periodically), reconnects with exponential backoff (1s → 30s cap).

## Usage

```typescript
import { Orchestrator } from "@sockt/orch";
import { SlackChannelGateway, SlackReplyTelemetry } from "@sockt/slack-gateway";

const slack = new SlackChannelGateway({
  appToken: process.env.SLACK_APP_TOKEN!, // xapp-...
  botToken: process.env.SLACK_BOT_TOKEN!, // xoxb-...
  tenantId: process.env.DEPLOYMENT_ID ?? "default",
});

const orch = new Orchestrator({
  port: 3100,
  dbPath: "./sockt.db",
  agents: [],
  channelGateway: slack,
  // Watches for tasks created from Slack messages and replies in the
  // originating channel/thread when they complete or escalate.
  telemetry: new SlackReplyTelemetry(slack),
});

await orch.start();
```

`Orchestrator` wires `channelGateway.onMessage()` internally — every inbound Slack message is routed to the matching agent (via `MessageRouter`) and a task is created automatically. `SlackReplyTelemetry` closes the loop by replying in Slack once that task finishes; pass your own `TelemetryEmitter` as a second argument (`new SlackReplyTelemetry(slack, myTelemetry)`) to keep other telemetry consumers working too.

## Getting Slack tokens

Run `sockt setup slack` from the CLI — it walks through creating a Slack app from a pre-configured manifest (Socket Mode + the right bot scopes already set) and stores the three tokens (app token, bot token, signing secret) encrypted in `~/.sockt/config.yaml`. `sockt deploy` decrypts and injects `SLACK_APP_TOKEN`/`SLACK_BOT_TOKEN` into the orchestrator process automatically when Slack is configured.

Required bot token scopes (already in the manifest): `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `im:write`, `mpim:history`, `mpim:read`.

## Limitations

- Single Slack workspace per deployment — `tenantId` is fixed at construction time, not derived per-message from Slack's `team_id`. Multi-workspace routing isn't implemented.
- Task → Slack destination correlation (so a completed task replies to the right channel/thread) lives in the orchestrator's telemetry layer, in memory — if the orchestrator restarts mid-task, that specific task won't get a Slack reply on completion (the task itself still completes normally).
- No file upload support — inbound file attachments are captured as URLs (`attachments` on `InboundMessage`) but outbound replies are text-only for now.

## Docs

Full architecture: [docs/ARCHITECTURE.md](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
