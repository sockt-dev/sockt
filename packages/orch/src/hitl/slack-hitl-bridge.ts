import type { SlackChannelGateway, SlackInteractionPayload } from "@sockt/slack-gateway";
import type { ApprovalStore, StoredApproval } from "../api/approval-store.ts";

const APPROVE_ACTION = "hitl_approve";
const DENY_ACTION = "hitl_deny";
const REREQUEST_ACTION = "hitl_rerequest";

/**
 * Posts a Block Kit approve/deny message to the Slack thread that triggered
 * the task requiring approval, and routes button clicks back into
 * ApprovalStore.decide(). Message ts is kept in an in-memory map (like
 * SlackReplyTelemetry) purely to edit the message after a decision — losing
 * that map across a restart just means the message is never edited in place,
 * not that the approval itself is lost (ApprovalStore is sqlite-backed).
 */
export class SlackHitlBridge {
  private readonly messageByApprovalId = new Map<string, { channelId: string; ts: string }>();

  constructor(
    private readonly gateway: SlackChannelGateway,
    private readonly approvalStore: ApprovalStore,
    /** Called with the taskId (not the spent approval's id) when a human
     * clicks "Re-request approval" on a timed-out approval message — see
     * postTimeoutNotice. Re-queues the task so the worker re-claims,
     * re-plans, and hits the same gated tool again, producing a fresh
     * approval row through the normal flow. */
    private readonly onRerequest?: (taskId: string) => Promise<void>,
  ) {
    this.gateway.onInteraction((payload) => this.handleInteraction(payload));
  }

  /** Posted once, HITL_REMINDER_LEAD_MS before an approval's timeout —
   * see ApprovalStore.sweepReminders / OrchestratorApi's sweep interval.
   * A plain thread message, not a new approve/deny prompt (the original
   * message's buttons are still live). */
  async postReminder(approval: StoredApproval, channelId: string, threadId: string | null): Promise<void> {
    const timeoutNote = approval.timeoutAt ? ` — times out <!date^${Math.floor(new Date(approval.timeoutAt).getTime() / 1000)}^{time}|soon>` : "";
    const text = `⏰ Reminder: approval for *${approval.action}* still pending${timeoutNote}.`;
    await this.gateway.sendBlocks(channelId, threadId, text, []);
  }

  /** Posted once an approval actually times out. Edits the original
   * approve/deny message in place (falling back to a fresh thread post via
   * the caller's taskOrigin lookup when the in-memory map missed — e.g. the
   * orch restarted between posting the request and it timing out) to offer
   * a "Re-request approval" button, since the original approval row is
   * spent (ApprovalStore.decide only accepts a still-pending row). */
  async postTimeoutNotice(approval: StoredApproval, fallback?: { channelId: string; threadId: string | null }): Promise<void> {
    const text = `Approval timed out: *${approval.action}* — task is blocked.`;
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Re-request approval" },
            action_id: REREQUEST_ACTION,
            value: approval.taskId,
          },
        ],
      },
    ];

    const tracked = this.messageByApprovalId.get(approval.id);
    if (tracked) {
      await this.gateway.updateBlocks(tracked.channelId, tracked.ts, text, blocks);
      this.messageByApprovalId.delete(approval.id);
    } else if (fallback) {
      const ts = await this.gateway.sendBlocks(fallback.channelId, fallback.threadId, text, blocks);
      this.messageByApprovalId.set(approval.id, { channelId: fallback.channelId, ts });
    }
  }

  async postApprovalRequest(approval: StoredApproval, channelId: string, threadId: string | null): Promise<void> {
    const text = `Approval needed: *${approval.action}*\n${approval.description}`;
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            action_id: APPROVE_ACTION,
            value: approval.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny" },
            style: "danger",
            action_id: DENY_ACTION,
            value: approval.id,
          },
        ],
      },
    ];

    const ts = await this.gateway.sendBlocks(channelId, threadId, text, blocks);
    this.messageByApprovalId.set(approval.id, { channelId, ts });
  }

  private async handleInteraction(payload: SlackInteractionPayload): Promise<void> {
    if (payload.type !== "block_actions") return;

    for (const action of payload.actions) {
      if (action.action_id === REREQUEST_ACTION) {
        const taskId = action.value;
        if (!taskId || !this.onRerequest) continue;
        await this.onRerequest(taskId);
        if (payload.channel && payload.message) {
          await this.gateway.updateBlocks(payload.channel.id, payload.message.ts, "Re-queued — the agent will re-request approval.", []);
        }
        continue;
      }

      if (action.action_id !== APPROVE_ACTION && action.action_id !== DENY_ACTION) continue;
      const approvalId = action.value;
      if (!approvalId) continue;

      const status = action.action_id === APPROVE_ACTION ? "approved" : "denied";
      const decided = this.approvalStore.decide(approvalId, { status, decidedBy: payload.user.id });
      if (!decided) continue;

      const outcomeText = `Approval ${status}: *${decided.action}*\n${decided.description}\n_Decided by <@${payload.user.id}>_`;
      const tracked = this.messageByApprovalId.get(approvalId);
      if (tracked) {
        await this.gateway.updateBlocks(tracked.channelId, tracked.ts, outcomeText, []);
        this.messageByApprovalId.delete(approvalId);
      } else if (payload.channel && payload.message) {
        // Restart-survival path: no in-memory record, but Slack still tells us
        // which message was clicked, so we can edit it directly.
        await this.gateway.updateBlocks(payload.channel.id, payload.message.ts, outcomeText, []);
      }
    }
  }
}
