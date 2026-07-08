import type { TelemetryEmitter } from "@sockt/types";
import type { SlackChannelGateway } from "./gateway.ts";

interface SlackDestination {
  channelId: string;
  threadId?: string;
}

/**
 * TelemetryEmitter that watches the orchestrator's event stream for tasks
 * created from a Slack message (task_created with data.source === "message")
 * and, when that task later completes or escalates, replies in the
 * originating Slack channel/thread via the Web API.
 *
 * This is how Slack replies work without touching the Task schema — the
 * task → Slack destination correlation lives here, in memory, keyed by
 * taskId. If the orchestrator restarts mid-task, that task's reply is lost
 * (the task itself still completes normally) — see the package README.
 *
 * Wrap an existing TelemetryEmitter via `inner` to keep other telemetry
 * consumers (logging, metrics) working unchanged.
 */
export class SlackReplyTelemetry implements TelemetryEmitter {
  private readonly pending = new Map<string, SlackDestination>();

  constructor(
    private readonly gateway: SlackChannelGateway,
    private readonly inner?: TelemetryEmitter,
  ) {}

  emit(event: { type: string; taskId?: string; tenantId: string; data: Record<string, unknown> }): void {
    this.inner?.emit(event);

    if (event.type === "task_created" && event.taskId && event.data.source === "message" && event.data.platform === "slack") {
      this.pending.set(event.taskId, {
        channelId: String(event.data.channelId),
        threadId: event.data.threadId ? String(event.data.threadId) : undefined,
      });
      return;
    }

    if ((event.type === "task_completed" || event.type === "task_escalated") && event.taskId) {
      const dest = this.pending.get(event.taskId);
      if (!dest) return;
      this.pending.delete(event.taskId);

      const content =
        event.type === "task_completed"
          ? String(event.data.output ?? "(no output)")
          : `⚠️ Escalated: ${String(event.data.reason ?? "budget exceeded")}`;

      this.gateway
        .send({ platform: "slack", channelId: dest.channelId, threadId: dest.threadId, content, tenantId: event.tenantId })
        .catch((err) => console.error("[slack-reply-telemetry] failed to send reply:", err));
    }
  }

  async flush(): Promise<void> {
    await this.inner?.flush();
  }
}
