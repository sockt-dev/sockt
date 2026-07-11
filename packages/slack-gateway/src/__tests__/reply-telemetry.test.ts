import { test, expect, describe } from "bun:test";
import { SlackReplyTelemetry } from "../reply-telemetry.ts";
import type { SlackChannelGateway } from "../gateway.ts";

function makeGatewayStub() {
  const sent: { channelId: string; threadId?: string; content: string }[] = [];
  const gateway = {
    send: async (msg: { channelId: string; threadId?: string; content: string }) => {
      sent.push(msg);
      return "ts-1";
    },
  } as unknown as SlackChannelGateway;
  return { gateway, sent };
}

describe("SlackReplyTelemetry", () => {
  test("replies using the in-memory map when task_created was seen in this process", async () => {
    const { gateway, sent } = makeGatewayStub();
    const telemetry = new SlackReplyTelemetry(gateway);

    telemetry.emit({
      type: "task_created",
      taskId: "t1",
      tenantId: "tenant-1",
      data: { source: "message", platform: "slack", channelId: "C1", threadId: "1000.1" },
    });
    telemetry.emit({ type: "task_completed", taskId: "t1", tenantId: "tenant-1", data: { output: "done" } });

    await Bun.sleep(10); // gateway.send is fire-and-forget in emit()
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe("C1");
    expect(sent[0]!.threadId).toBe("1000.1");
  });

  test("falls back to originLookup when the task wasn't created in this process (e.g. after a restart)", async () => {
    const { gateway, sent } = makeGatewayStub();
    const originLookup = (taskId: string) =>
      taskId === "t2" ? { channelId: "C2", threadId: "2000.1" } : null;
    const telemetry = new SlackReplyTelemetry(gateway, undefined, originLookup);

    // No task_created event this time — simulates a task that was created
    // before this orch process started.
    telemetry.emit({ type: "task_completed", taskId: "t2", tenantId: "tenant-1", data: { output: "done" } });

    await Bun.sleep(10);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channelId).toBe("C2");
    expect(sent[0]!.threadId).toBe("2000.1");
  });

  test("no reply and no throw when neither the map nor originLookup has the task", async () => {
    const { gateway, sent } = makeGatewayStub();
    const telemetry = new SlackReplyTelemetry(gateway, undefined, () => null);

    telemetry.emit({ type: "task_completed", taskId: "unknown-task", tenantId: "tenant-1", data: { output: "done" } });

    await Bun.sleep(10);
    expect(sent).toHaveLength(0);
  });

  test("blocked keeps the correlation for a later completed/escalated reply; completed/escalated clear it", async () => {
    const { gateway, sent } = makeGatewayStub();
    const telemetry = new SlackReplyTelemetry(gateway);

    telemetry.emit({
      type: "task_created",
      taskId: "t3",
      tenantId: "tenant-1",
      data: { source: "message", platform: "slack", channelId: "C3", threadId: "3000.1" },
    });
    telemetry.emit({ type: "task_blocked", taskId: "t3", tenantId: "tenant-1", data: { dependency: "HITL denied" } });
    telemetry.emit({ type: "task_completed", taskId: "t3", tenantId: "tenant-1", data: { output: "done after unblock" } });

    await Bun.sleep(10);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.content).toContain("Blocked");
    expect(sent[1]!.content).toBe("done after unblock");

    // A third event for the same (now-cleared) task should not reply again.
    telemetry.emit({ type: "task_completed", taskId: "t3", tenantId: "tenant-1", data: { output: "stray" } });
    await Bun.sleep(10);
    expect(sent).toHaveLength(2);
  });

  test("markdown is converted to Slack mrkdwn in the reply", async () => {
    const { gateway, sent } = makeGatewayStub();
    const telemetry = new SlackReplyTelemetry(gateway);

    telemetry.emit({
      type: "task_created",
      taskId: "t4",
      tenantId: "tenant-1",
      data: { source: "message", platform: "slack", channelId: "C4" },
    });
    telemetry.emit({ type: "task_completed", taskId: "t4", tenantId: "tenant-1", data: { output: "**bold** and\n## Heading" } });

    await Bun.sleep(10);
    expect(sent[0]!.content).toContain("*bold*");
    expect(sent[0]!.content).not.toContain("**bold**");
    expect(sent[0]!.content).toContain("*Heading*");
  });
});
