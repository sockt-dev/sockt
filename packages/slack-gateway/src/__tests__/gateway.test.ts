import { test, expect, describe } from "bun:test";
import { SlackChannelGateway } from "../gateway.ts";
import type { SlackMessageEvent } from "../types.ts";

function baseEvent(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    type: "message",
    channel: "C123",
    user: "U1",
    text: "@sockt hello",
    ts: "1700000000.000100",
    ...overrides,
  };
}

// toInboundMessage is private — accessed the same way SlackHitlBridge's tests
// reach a private method, since exercising this through a live Socket Mode
// connection isn't practical in a unit test.
function toInbound(gateway: SlackChannelGateway, event: SlackMessageEvent) {
  return (gateway as unknown as { toInboundMessage(e: SlackMessageEvent): unknown }).toInboundMessage(event);
}

describe("SlackChannelGateway event dedup", () => {
  test("the same channel:ts is only converted to an InboundMessage once", () => {
    const gateway = new SlackChannelGateway({ appToken: "xapp", botToken: "xoxb", tenantId: "t1" });

    const first = toInbound(gateway, baseEvent());
    const second = toInbound(gateway, baseEvent());

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test("this is what fixes the dominant 2026-07-11 eval defect: a message + app_mention event pair for one human send, same ts, only produces one task", () => {
    const gateway = new SlackChannelGateway({ appToken: "xapp", botToken: "xoxb", tenantId: "t1" });

    const messageEvent = toInbound(gateway, baseEvent({ type: "message" }));
    const appMentionEvent = toInbound(gateway, baseEvent({ type: "app_mention" }));

    expect(messageEvent).not.toBeNull();
    expect(appMentionEvent).toBeNull();
  });

  test("different ts values (genuinely distinct messages) are not deduped against each other", () => {
    const gateway = new SlackChannelGateway({ appToken: "xapp", botToken: "xoxb", tenantId: "t1" });

    const a = toInbound(gateway, baseEvent({ ts: "1700000000.000100" }));
    const b = toInbound(gateway, baseEvent({ ts: "1700000000.000200" }));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  test("same ts in a different channel is not deduped (key includes channel)", () => {
    const gateway = new SlackChannelGateway({ appToken: "xapp", botToken: "xoxb", tenantId: "t1" });

    const a = toInbound(gateway, baseEvent({ channel: "C1", ts: "1700000000.000100" }));
    const b = toInbound(gateway, baseEvent({ channel: "C2", ts: "1700000000.000100" }));

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  test("the seen-event cache doesn't grow unbounded — oldest entries are evicted past the cap", () => {
    const gateway = new SlackChannelGateway({ appToken: "xapp", botToken: "xoxb", tenantId: "t1" });

    // Push past the internal cap (500) with distinct ts values.
    for (let i = 0; i < 501; i++) {
      toInbound(gateway, baseEvent({ ts: `1700000000.${String(i).padStart(6, "0")}` }));
    }

    // The very first ts should have been evicted, so it's treated as new again.
    const replay = toInbound(gateway, baseEvent({ ts: "1700000000.000000" }));
    expect(replay).not.toBeNull();
  });
});
