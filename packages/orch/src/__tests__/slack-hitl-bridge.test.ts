import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import type { Database } from "bun:sqlite";
import { SlackChannelGateway } from "@sockt/slack-gateway";
import type { SlackInteractionPayload } from "@sockt/slack-gateway";
import { ApprovalStore } from "../api/approval-store.ts";
import { SlackHitlBridge } from "../hitl/slack-hitl-bridge.ts";

interface CapturedCall {
  method: string;
  body: any;
}

describe("SlackHitlBridge", () => {
  let db: Database;
  let approvalStore: ApprovalStore;
  let gateway: SlackChannelGateway;
  let bridge: SlackHitlBridge;
  let calls: CapturedCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    db = createTestDb();
    approvalStore = new ApprovalStore(db);
    gateway = new SlackChannelGateway({ appToken: "xapp-test", botToken: "xoxb-test", tenantId: "t1" });
    bridge = new SlackHitlBridge(gateway, approvalStore);

    calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = url.split("/api/")[1] ?? url;
      calls.push({ method, body });

      if (method === "chat.postMessage") {
        return Response.json({ ok: true, ts: `ts-${calls.length}` });
      }
      if (method === "chat.update") {
        return Response.json({ ok: true, ts: body.ts });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("postApprovalRequest posts a message with approve/deny buttons", async () => {
    const approval = approvalStore.create({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-1",
      tier: "confirm",
      action: "exec_code",
      description: "Run rm -rf /tmp/scratch",
    });

    await bridge.postApprovalRequest(approval, "C123", "1700000000.000100");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.postMessage");
    expect(calls[0].body.channel).toBe("C123");
    expect(calls[0].body.thread_ts).toBe("1700000000.000100");
    const actionsBlock = calls[0].body.blocks.find((b: any) => b.type === "actions");
    const actionIds = actionsBlock.elements.map((el: any) => el.action_id);
    expect(actionIds).toEqual(["hitl_approve", "hitl_deny"]);
    expect(actionsBlock.elements.every((el: any) => el.value === approval.id)).toBe(true);
  });

  test("approve button click decides the approval and edits the message", async () => {
    const approval = approvalStore.create({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-2",
      tier: "confirm",
      action: "http_request",
      description: "POST to external webhook",
    });
    await bridge.postApprovalRequest(approval, "C123", null);
    calls = []; // only care about calls made during the interaction from here

    const payload: SlackInteractionPayload = {
      type: "block_actions",
      user: { id: "U999" },
      actions: [{ action_id: "hitl_approve", value: approval.id }],
    };
    await (bridge as unknown as { handleInteraction(p: SlackInteractionPayload): Promise<void> }).handleInteraction(payload);

    const decided = approvalStore.get(approval.id);
    expect(decided?.status).toBe("approved");
    expect(decided?.decidedBy).toBe("U999");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.update");
    expect(calls[0].body.text).toContain("approved");
  });

  test("deny button click decides the approval as denied", async () => {
    const approval = approvalStore.create({
      tenantId: "t1",
      agentId: "agent-1",
      taskId: "task-3",
      tier: "confirm",
      action: "exec_code",
      description: "Delete production data",
    });
    await bridge.postApprovalRequest(approval, "C123", null);

    const payload: SlackInteractionPayload = {
      type: "block_actions",
      user: { id: "U999" },
      actions: [{ action_id: "hitl_deny", value: approval.id }],
    };
    await (bridge as unknown as { handleInteraction(p: SlackInteractionPayload): Promise<void> }).handleInteraction(payload);

    const decided = approvalStore.get(approval.id);
    expect(decided?.status).toBe("denied");
  });

  test("ignores non-block_actions interaction payloads", async () => {
    const payload = { type: "view_submission", user: { id: "U1" }, actions: [] } as unknown as SlackInteractionPayload;
    await (bridge as unknown as { handleInteraction(p: SlackInteractionPayload): Promise<void> }).handleInteraction(payload);
    expect(calls).toHaveLength(0);
  });

  test("postReminder posts a plain thread message, not a new approve/deny prompt", async () => {
    const approval = approvalStore.create({
      tenantId: "t1", agentId: "agent-1", taskId: "task-4", tier: "confirm",
      action: "exec_code", description: "Run migration", timeoutMs: 300_000,
    });
    await bridge.postReminder(approval, "C123", "1700000000.000100");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.postMessage");
    expect(calls[0].body.text).toContain("Reminder");
    expect(calls[0].body.text).toContain("exec_code");
    const actionsBlock = (calls[0].body.blocks ?? []).find((b: any) => b.type === "actions");
    expect(actionsBlock).toBeUndefined();
  });

  test("postTimeoutNotice edits the original message with a re-request button", async () => {
    const approval = approvalStore.create({
      tenantId: "t1", agentId: "agent-1", taskId: "task-5", tier: "confirm",
      action: "exec_code", description: "Run migration",
    });
    await bridge.postApprovalRequest(approval, "C123", null);
    calls = [];

    await bridge.postTimeoutNotice(approval);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.update");
    const actionsBlock = calls[0].body.blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock.elements[0].action_id).toBe("hitl_rerequest");
    expect(actionsBlock.elements[0].value).toBe(approval.taskId);
  });

  test("postTimeoutNotice falls back to a fresh thread post when there's no tracked message (e.g. after a restart)", async () => {
    const approval = approvalStore.create({
      tenantId: "t1", agentId: "agent-1", taskId: "task-6", tier: "confirm",
      action: "exec_code", description: "Run migration",
    });
    // No postApprovalRequest call — simulates the in-memory map missing the entry.
    await bridge.postTimeoutNotice(approval, { channelId: "C456", threadId: "1700000000.000200" });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.postMessage");
    expect(calls[0].body.channel).toBe("C456");
  });

  test("clicking re-request calls onRerequest with the taskId and edits the message", async () => {
    const rerequested: string[] = [];
    const rerequestBridge = new SlackHitlBridge(gateway, approvalStore, async (taskId) => {
      rerequested.push(taskId);
    });

    const payload: SlackInteractionPayload = {
      type: "block_actions",
      user: { id: "U999" },
      actions: [{ action_id: "hitl_rerequest", value: "task-7" }],
      channel: { id: "C123" },
      message: { ts: "1700000000.000300" },
    } as unknown as SlackInteractionPayload;

    await (rerequestBridge as unknown as { handleInteraction(p: SlackInteractionPayload): Promise<void> }).handleInteraction(payload);

    expect(rerequested).toEqual(["task-7"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("chat.update");
    expect(calls[0].body.text).toContain("Re-queued");
  });

  test("re-request click is a no-op when no onRerequest callback was provided", async () => {
    const payload: SlackInteractionPayload = {
      type: "block_actions",
      user: { id: "U999" },
      actions: [{ action_id: "hitl_rerequest", value: "task-8" }],
    } as unknown as SlackInteractionPayload;

    await (bridge as unknown as { handleInteraction(p: SlackInteractionPayload): Promise<void> }).handleInteraction(payload);
    expect(calls).toHaveLength(0);
  });
});

describe("ApprovalStore.sweepReminders", () => {
  let db: Database;
  let approvalStore: ApprovalStore;

  beforeEach(() => {
    db = createTestDb();
    approvalStore = new ApprovalStore(db);
  });

  test("returns and marks pending approvals within the reminder lead window", () => {
    const approval = approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", timeoutMs: 60_000, // times out in 1 minute
    });

    const due = approvalStore.sweepReminders(120_000); // remind if timeout is within 2 minutes
    expect(due.map((a) => a.id)).toContain(approval.id);
  });

  test("does not re-return an approval it already reminded", () => {
    approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", timeoutMs: 60_000,
    });

    const first = approvalStore.sweepReminders(120_000);
    expect(first).toHaveLength(1);
    const second = approvalStore.sweepReminders(120_000);
    expect(second).toHaveLength(0);
  });

  test("does not return an approval whose timeout is outside the lead window", () => {
    approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", timeoutMs: 10 * 60_000, // 10 minutes out
    });

    const due = approvalStore.sweepReminders(120_000); // only within 2 minutes
    expect(due).toHaveLength(0);
  });

  test("does not return an approval with no timeout at all", () => {
    approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", // no timeoutMs
    });

    const due = approvalStore.sweepReminders(120_000);
    expect(due).toHaveLength(0);
  });

  test("does not remind an approval that's already been decided", () => {
    const approval = approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", timeoutMs: 60_000,
    });
    approvalStore.decide(approval.id, { status: "approved" });

    const due = approvalStore.sweepReminders(120_000);
    expect(due).toHaveLength(0);
  });

  test("does not return an approval whose timeout has already passed (regression: reminder+timeout firing in the same sweep tick)", () => {
    // Without a lower bound on timeout_at, sweepReminders would match this
    // (timeout_at <= cutoff is trivially true for anything already in the
    // past too), so the same approval would get a "reminder, times out
    // soon" message followed immediately by sweepTimeouts' "timed out"
    // message in the very same sweep interval tick.
    approvalStore.create({
      tenantId: "t1", agentId: "a1", taskId: "task-1", tier: "confirm",
      action: "exec_code", description: "d", timeoutMs: -1000, // already expired
    });

    const due = approvalStore.sweepReminders(120_000);
    expect(due).toHaveLength(0);
  });
});
