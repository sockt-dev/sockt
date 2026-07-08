import { Database } from "bun:sqlite";
import { initializeSchema } from "@sockt/fsm";
import type { ChannelGateway, TelemetryEmitter } from "@sockt/types";
import { Orchestrator } from "./orchestrator.ts";

const port = Number(process.env.PORT ?? 3100);
const deploymentId = process.env.DEPLOYMENT_ID ?? "default";
const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/.sockt/scratch/orch.sqlite`;

const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
await Bun.write(Bun.file(dir + "/.keep"), "");

const db = new Database(dbPath, { create: true });
initializeSchema(db);

let channelGateway: ChannelGateway | undefined;
let telemetry: TelemetryEmitter | undefined;

const slackAppToken = process.env.SLACK_APP_TOKEN;
const slackBotToken = process.env.SLACK_BOT_TOKEN;

if (slackAppToken && slackBotToken) {
  const { SlackChannelGateway, SlackReplyTelemetry } = await import("@sockt/slack-gateway");
  const slack = new SlackChannelGateway({ appToken: slackAppToken, botToken: slackBotToken, tenantId: deploymentId });
  channelGateway = slack;
  telemetry = new SlackReplyTelemetry(slack);
  console.log("[orch] Slack integration enabled (Socket Mode)");
}

const orch = new Orchestrator({
  port,
  dbPath,
  db,
  agents: [],
  channelGateway,
  telemetry,
});

await orch.start();
console.log(`[orch] listening on port ${orch.getPort()}, tenant=${deploymentId}`);
