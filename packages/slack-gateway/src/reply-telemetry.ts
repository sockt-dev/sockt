import type { TelemetryEmitter } from "@sockt/types";
import type { SlackChannelGateway } from "./gateway.ts";

interface SlackDestination {
  channelId: string;
  threadId?: string;
}

/**
 * LLM output is standard Markdown; Slack renders its own "mrkdwn" dialect,
 * which differs just enough that raw Markdown shows literal asterisks/hashes
 * instead of formatting (e.g. **bold** is plain text in Slack — bold there
 * is single *asterisks*). Only handles the constructs actually seen in task
 * output (bold, headers, bullets, links) — not a full Markdown parser.
 */
function markdownToSlackMrkdwn(text: string): string {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*") // headers -> bold line
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** -> *bold* (Slack's bold syntax)
    .replace(/^(\s*)[-•]\s+/gm, "$1• ") // bullets -> consistent •
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>"); // [text](url) -> <url|text>
}

/** Fallback lookup for when the in-memory `pending` map doesn't have an
 * entry — e.g. the orch process restarted since the task was created. Backed
 * by TaskOriginStore (sqlite), injected rather than imported directly so this
 * package doesn't need to depend on @sockt/orch. Returns null/undefined if
 * there's no persisted origin for the task. */
export type OriginLookup = (taskId: string) => { channelId: string; threadId: string | null } | null | undefined;

/**
 * TelemetryEmitter that watches the orchestrator's event stream for tasks
 * created from a Slack message (task_created with data.source === "message")
 * and, when that task later completes, escalates, or blocks, replies in the
 * originating Slack channel/thread via the Web API.
 *
 * The task → Slack destination correlation lives primarily in memory, keyed
 * by taskId, for zero-latency lookups within one orch process's lifetime. If
 * `originLookup` is supplied (see OriginLookup) it's consulted as a fallback
 * when the in-memory map misses — e.g. after an orch restart, or a task that
 * was blocked in a previous process lifetime getting unblocked in this one.
 * Without it, a restart mid-task still loses that task's reply, as documented
 * before this fallback existed (confirmed by mechanical probe M3 in the
 * 2026-07-11 eval pass).
 *
 * Wrap an existing TelemetryEmitter via `inner` to keep other telemetry
 * consumers (logging, metrics) working unchanged.
 */
export class SlackReplyTelemetry implements TelemetryEmitter {
  private readonly pending = new Map<string, SlackDestination>();

  constructor(
    private readonly gateway: SlackChannelGateway,
    private readonly inner?: TelemetryEmitter,
    private readonly originLookup?: OriginLookup,
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

    if (
      (event.type === "task_completed" ||
        event.type === "task_escalated" ||
        event.type === "task_blocked" ||
        event.type === "task_needs_input") &&
      event.taskId
    ) {
      let dest = this.pending.get(event.taskId);
      if (!dest) {
        const origin = this.originLookup?.(event.taskId);
        if (origin) {
          dest = { channelId: origin.channelId, threadId: origin.threadId ?? undefined };
          // Cache it so a later event for the same task (e.g. blocked now,
          // completed later) doesn't need another lookup.
          this.pending.set(event.taskId, dest);
        }
      }
      if (!dest) return;
      // blocked/needs_input are not terminal (blocked -> pending is a legal
      // FSM transition — a human can unblock via approval or by answering a
      // clarifying question), so keep the correlation around for whatever
      // reply comes next. completed/escalated are terminal: no more replies
      // will follow.
      if (event.type !== "task_blocked" && event.type !== "task_needs_input") this.pending.delete(event.taskId);

      const dependency = String(event.data.dependency ?? "");
      const rawContent =
        event.type === "task_completed" ? String(event.data.output ?? "(no output)")
        : event.type === "task_escalated" ? `⚠️ Escalated: ${String(event.data.reason ?? "budget exceeded")}`
        : event.type === "task_needs_input" ? `❓ ${String(event.data.question ?? "Need more information to continue.")}`
        // A parent that delegated via create_task and is waiting on its
        // children isn't "blocked on a human" the way a HITL denial or a
        // clarifying question is — say so, so a wait-in-progress doesn't
        // read as something needing action.
        : dependency.startsWith("awaiting-children:")
          ? `⏳ Delegated to ${dependency.split(":")[1]?.split(",").length ?? "several"} subtask(s) — will reply here once they finish.`
        : `⏸️ Blocked: ${dependency || "waiting on a human"}`;
      const content = markdownToSlackMrkdwn(rawContent);

      this.gateway
        .send({ platform: "slack", channelId: dest.channelId, threadId: dest.threadId, content, tenantId: event.tenantId })
        .catch((err) => console.error("[slack-reply-telemetry] failed to send reply:", err));
    }
  }

  async flush(): Promise<void> {
    await this.inner?.flush();
  }
}
