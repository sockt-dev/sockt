import { Database } from "bun:sqlite";
import { initializeSchema } from "@sockt/fsm";
import type { ChannelGateway, TelemetryEmitter } from "@sockt/types";
import { Orchestrator } from "./orchestrator.ts";
import type { RoutingConfig } from "./orchestrator.ts";
import { TaskOriginStore } from "./store/task-origin-store.ts";

const port = Number(process.env.PORT ?? 3100);
const deploymentId = process.env.DEPLOYMENT_ID ?? "default";
const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/.sockt/scratch/orch.sqlite`;

const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
await Bun.write(Bun.file(dir + "/.keep"), "");

const db = new Database(dbPath, { create: true });
initializeSchema(db);

// Same db handle as the Orchestrator instance below (which constructs its own
// TaskOriginStore internally) — sqlite handles multiple statement handles
// against one connection fine within a single process. Constructed here too
// so SlackReplyTelemetry has a fallback lookup independent of Orchestrator's
// internals.
const taskOriginStore = new TaskOriginStore(db);

let channelGateway: ChannelGateway | undefined;
let telemetry: TelemetryEmitter | undefined;
let onApprovalCreated: ((approval: import("./api/approval-store.ts").StoredApproval) => void) | undefined;

const slackAppToken = process.env.SLACK_APP_TOKEN;
const slackBotToken = process.env.SLACK_BOT_TOKEN;

if (slackAppToken && slackBotToken) {
  const { SlackChannelGateway, SlackReplyTelemetry } = await import("@sockt/slack-gateway");
  const { SlackHitlBridge } = await import("./hitl/slack-hitl-bridge.ts");
  const { ApprovalStore } = await import("./api/approval-store.ts");
  const slack = new SlackChannelGateway({ appToken: slackAppToken, botToken: slackBotToken, tenantId: deploymentId });
  channelGateway = slack;
  telemetry = new SlackReplyTelemetry(slack, undefined, (taskId) => taskOriginStore.get(taskId));

  // Same db handle, same underlying pending_human_inputs rows as the
  // ApprovalStore OrchestratorApi constructs internally — this instance
  // exists only so the bridge can call .decide() from a button click without
  // Orchestrator/OrchestratorApi needing to expose their internal one.
  const approvalStore = new ApprovalStore(db);
  const bridge = new SlackHitlBridge(slack, approvalStore);
  onApprovalCreated = (approval) => {
    const origin = taskOriginStore.get(approval.taskId);
    if (!origin) {
      console.warn(`[orch] approval=${approval.id} has no known task origin — cannot post Slack approval message`);
      return;
    }
    bridge.postApprovalRequest(approval, origin.channelId, origin.threadId).catch((err) => {
      console.error(`[orch] failed to post approval request for approval=${approval.id}:`, err);
    });
  };

  console.log("[orch] Slack integration enabled (Socket Mode)");
}

// Content routes are first-match-wins (see MessageRouter) — department-specific
// keyword rules must be registered before the catch-all so specific beats generic.
//
// Trigger token: Slack's composer silently upgrades a plain-text "@sockt" into
// a real mention token (<@BOTUSERID>) when it matches an app member's name, so
// event.text may contain either the literal string or the mention token
// depending on how the client sent it. Match both.
const TRIGGER = String.raw`(?:@sockt\b|<@[A-Z0-9]+>)`;
const defaultRouteDepartment = process.env.DEFAULT_ROUTE_DEPARTMENT ?? "growth";
const routing: RoutingConfig = {
  contentRoutes: [
    { pattern: new RegExp(`${TRIGGER}[\\s\\S]*\\b(outreach|cold email|campaign|leads?|k-factor|funnel|signups?|referrals?)\\b`, "i"), department: "growth", role: "architect" },
    { pattern: new RegExp(`${TRIGGER}[\\s\\S]*\\b(prd|rice|jtbd|jobs.to.be.done|churn\\w*|mau|feature|sso|okta|azure ad)\\b`, "i"), department: "product", role: "architect" },
    // "down"/"fix" alone are too generic (a growth message like "our signups
    // are down" shouldn't misroute to engops), so match the specific urgency
    // phrasing instead — this is the exact gap E5 ("everything is down!!! fix
    // it now") exposed: it had no engops keyword match at all and fell through
    // to the growth catch-all.
    { pattern: new RegExp(`${TRIGGER}[\\s\\S]*\\b(runbook|postgres|deploy(ment|ed)?|incident|error rate|ssh|nginx|rollback|cluster|prod|everything('?s| is) down|site('?s| is) down|(production|prod) is down|fix it now)\\b`, "i"), department: "engops", role: "architect" },
    // Catch-all: any trigger that didn't match a department keyword still gets
    // a task (and thus a reply/decline) instead of being silently dropped.
    { pattern: new RegExp(TRIGGER, "i"), department: defaultRouteDepartment, role: "architect" },
  ],
  channelRoutes: process.env.SLACK_GROWTH_CHANNEL_ID
    ? [{ channelId: process.env.SLACK_GROWTH_CHANNEL_ID, department: "growth", role: "architect" }]
    : [],
};

const orch = new Orchestrator({
  port,
  dbPath,
  db,
  agents: [],
  channelGateway,
  telemetry,
  routing,
  onApprovalCreated,
});

await orch.start();
console.log(`[orch] listening on port ${orch.getPort()}, tenant=${deploymentId}`);
