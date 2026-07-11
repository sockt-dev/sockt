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
});
