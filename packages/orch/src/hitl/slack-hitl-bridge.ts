import type { SlackChannelGateway, SlackInteractionPayload } from "@sockt/slack-gateway";
import type { ApprovalStore, StoredApproval } from "../api/approval-store.ts";

const APPROVE_ACTION = "hitl_approve";
const DENY_ACTION = "hitl_deny";

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
  ) {
    this.gateway.onInteraction((payload) => this.handleInteraction(payload));
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
