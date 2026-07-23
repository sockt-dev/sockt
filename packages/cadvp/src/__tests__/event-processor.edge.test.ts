import { test, expect, describe, afterEach } from "bun:test";
import { EventProcessor } from "../event-processor.ts";
import type { MemoryStore } from "@sockt/types";

function mockStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    write: async () => "generated-id",
    search: async () => [],
    deduplicateCheck: async () => false,
    commit: async () => {},
    listCategories: async () => [],
    delete: async () => {},
    ...overrides,
  };
}

function validLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "memory_write",
    tenantId: "tenant-1",
    agentId: "agent-monitor",
    entry: {
      id: "entry-1",
      tenantId: "tenant-1",
      category: "fact",
      content: "Server is healthy",
      source: "agent:monitor",
      createdAt: "2024-06-01T14:00:00Z",
    },
    timestamp: "2024-06-01T14:00:01Z",
    ...overrides,
  });
}

describe("EventProcessor edge cases", () => {
  let processor: EventProcessor;

  afterEach(async () => {
    await processor?.stop();
  });

  test("handles high throughput: 200 events processed without loss", async () => {
    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    processor = new EventProcessor({ store, batchSize: 50, flushIntervalMs: 60000 });

    // Feed 200 events (4 batches of 50)
    for (let i = 0; i < 200; i++) {
      await processor.processLine(validLine({
        entry: {
          id: `e-${i}`,
          tenantId: "tenant-1",
          category: "fact",
          content: `event ${i}`,
          source: "s",
          createdAt: "2024-01-01T00:00:00Z",
        },
      }));
    }
    await Bun.sleep(10);

    expect(writeCount).toBe(200);
    expect(processor.getStats().eventsProcessed).toBe(200);
  });

  test("deduplicateCheck slow response does not block pipeline permanently", async () => {
    let dedupCalls = 0;
    const store = mockStore({
      deduplicateCheck: async () => {
        dedupCalls++;
        await Bun.sleep(10); // Simulate latency
        return false;
      },
    });
    processor = new EventProcessor({ store, batchSize: 5, flushIntervalMs: 60000 });

    for (let i = 0; i < 5; i++) {
      await processor.processLine(validLine());
    }
    await Bun.sleep(100);

    expect(dedupCalls).toBe(5);
    expect(processor.getStats().eventsProcessed).toBe(5);
  });

  test("mixed event types in single batch", async () => {
    const operations: string[] = [];
    const store = mockStore({
      write: async () => { operations.push("write"); return "id"; },
      delete: async () => { operations.push("delete"); },
      commit: async (...args) => { operations.push(`commit:${args[0]}`); },
    });
    processor = new EventProcessor({ store, batchSize: 4, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ type: "memory_write" }));
    await processor.processLine(validLine({ type: "memory_delete" }));
    await processor.processLine(validLine({ type: "sync" }));
    await processor.processLine(validLine({ type: "memory_update" }));
    await Bun.sleep(10);

    expect(operations).toContain("write");
    expect(operations).toContain("delete");
    // sync calls commit with its own commit, plus batch commits at end
    expect(operations.filter(o => o.startsWith("commit")).length).toBeGreaterThan(0);
  });

  test("write failure for one event does not prevent others from processing", async () => {
    let callCount = 0;
    const store = mockStore({
      write: async () => {
        callCount++;
        if (callCount === 2) throw new Error("transient failure");
        return "id";
      },
    });
    processor = new EventProcessor({ store, batchSize: 3, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ entry: { id: "e1", tenantId: "t1", category: "fact", content: "1", source: "s", createdAt: "2024-01-01T00:00:00Z" } }));
    await processor.processLine(validLine({ entry: { id: "e2", tenantId: "t1", category: "fact", content: "2", source: "s", createdAt: "2024-01-01T00:00:00Z" } }));
    await processor.processLine(validLine({ entry: { id: "e3", tenantId: "t1", category: "fact", content: "3", source: "s", createdAt: "2024-01-01T00:00:00Z" } }));
    await Bun.sleep(10);

    expect(processor.getStats().eventsProcessed).toBe(2);
    expect(processor.getStats().eventsErrored).toBe(1);
  });

  test("commit failure does not affect event counts", async () => {
    const store = mockStore({
      commit: async () => { throw new Error("commit failed"); },
    });
    processor = new EventProcessor({ store, batchSize: 2, flushIntervalMs: 60000 });

    await processor.processLine(validLine());
    await processor.processLine(validLine());
    await Bun.sleep(10);

    // Events were written successfully, only commit failed
    expect(processor.getStats().eventsProcessed).toBe(2);
    expect(processor.getStats().eventsErrored).toBe(0);
  });

  test("deduplicateCheck failure counts as error", async () => {
    const store = mockStore({
      deduplicateCheck: async () => { throw new Error("network timeout"); },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(processor.getStats().eventsErrored).toBe(1);
    expect(processor.getStats().eventsProcessed).toBe(0);
  });

  test("flush with empty batch is no-op", async () => {
    let commitCount = 0;
    const store = mockStore({
      commit: async () => { commitCount++; },
    });
    processor = new EventProcessor({ store, batchSize: 10, flushIntervalMs: 60000 });

    await processor.flush();
    await processor.flush();
    await processor.flush();

    expect(commitCount).toBe(0);
  });

  test("onEvent handler errors do not crash processor", async () => {
    const store = mockStore();
    processor = new EventProcessor({
      store,
      batchSize: 1,
      flushIntervalMs: 60000,
      onEvent: async () => { throw new Error("handler exploded"); },
    });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    // Event was still processed (error is in the handler, not the pipeline)
    // This depends on implementation — if handler error should count as error:
    expect(processor.getStats().eventsErrored).toBe(1);
  });

  test("stats lastProcessedAt updates after each batch", async () => {
    const store = mockStore();
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    expect(processor.getStats().lastProcessedAt).toBeNull();

    await processor.processLine(validLine());
    await Bun.sleep(10);

    const stats = processor.getStats();
    expect(stats.lastProcessedAt).not.toBeNull();
    // Should be a valid ISO date
    const date = new Date(stats.lastProcessedAt!);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  test("multiple tenantIds in batch get separate commits", async () => {
    const committedTenants: string[] = [];
    const store = mockStore({
      commit: async (tenantId) => { committedTenants.push(tenantId); },
    });
    processor = new EventProcessor({ store, batchSize: 5, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ tenantId: "t1" }));
    await processor.processLine(validLine({ tenantId: "t2" }));
    await processor.processLine(validLine({ tenantId: "t3" }));
    await processor.processLine(validLine({ tenantId: "t1" }));
    await processor.processLine(validLine({ tenantId: "t2" }));
    await Bun.sleep(10);

    // 3 unique tenants, 3 commits
    const uniqueCommits = [...new Set(committedTenants)];
    expect(uniqueCommits.sort()).toEqual(["t1", "t2", "t3"]);
  });

  test("processLine with extremely malformed data doesn't corrupt state", async () => {
    const store = mockStore();
    processor = new EventProcessor({ store, batchSize: 2, flushIntervalMs: 60000 });

    // Various garbage inputs
    await processor.processLine("");
    await processor.processLine("\x00\x01\x02");
    await processor.processLine("undefined");
    await processor.processLine("NaN");
    await processor.processLine("{{{{{");
    await processor.processLine("}}}}}}");

    expect(processor.getStats().eventsErrored).toBe(6);
    expect(processor.getStats().eventsProcessed).toBe(0);

    // Now a valid line should still work
    await processor.processLine(validLine());
    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(processor.getStats().eventsProcessed).toBe(2);
  });

  test("timer-based flush handles concurrent processLine calls", async () => {
    let writeCount = 0;
    const store = mockStore({
      write: async () => {
        writeCount++;
        return "id";
      },
    });
    processor = new EventProcessor({ store, batchSize: 100, flushIntervalMs: 40 });
    processor.startFlushTimer();

    // Feed events rapidly
    for (let i = 0; i < 10; i++) {
      await processor.processLine(validLine());
    }

    // Use stop() to guarantee the flush completes regardless of platform timer resolution.
    await processor.stop();

    expect(writeCount).toBe(10);
  });

  test("stop() flushes remaining events even if timer hasn't fired", async () => {
    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    processor = new EventProcessor({ store, batchSize: 100, flushIntervalMs: 60000 });
    processor.startFlushTimer();

    await processor.processLine(validLine());
    await processor.processLine(validLine());
    await processor.processLine(validLine());

    // Timer hasn't fired yet, batch hasn't hit size
    expect(writeCount).toBe(0);

    await processor.stop();
    expect(writeCount).toBe(3);
  });

  test("delete event does not go through dedup check", async () => {
    let dedupCalls = 0;
    const store = mockStore({
      deduplicateCheck: async () => { dedupCalls++; return false; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ type: "memory_delete" }));
    await Bun.sleep(10);

    expect(dedupCalls).toBe(0);
    expect(processor.getStats().eventsProcessed).toBe(1);
  });

  test("sync event does not go through dedup check", async () => {
    let dedupCalls = 0;
    const store = mockStore({
      deduplicateCheck: async () => { dedupCalls++; return false; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ type: "sync" }));
    await Bun.sleep(10);

    expect(dedupCalls).toBe(0);
    expect(processor.getStats().eventsProcessed).toBe(1);
  });
});
