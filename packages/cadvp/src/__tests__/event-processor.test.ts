import { test, expect, describe, beforeEach, afterEach } from "bun:test";
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

describe("EventProcessor", () => {
  let processor: EventProcessor;

  afterEach(async () => {
    await processor?.stop();
  });

  test("processes valid memory_write: dedup check + write", async () => {
    let writtenEntry: unknown = null;
    const store = mockStore({
      write: async (entry) => { writtenEntry = entry; return "new-id"; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(writtenEntry).not.toBeNull();
    const written = writtenEntry as Record<string, unknown>;
    expect(written.content).toBe("Server is healthy");
    expect(written.tenantId).toBe("tenant-1");
    // id and createdAt should be stripped
    expect(written).not.toHaveProperty("id");
    expect(written).not.toHaveProperty("createdAt");
  });

  test("skips duplicate events (deduplicateCheck returns true)", async () => {
    let writeCount = 0;
    const store = mockStore({
      deduplicateCheck: async () => true,
      write: async () => { writeCount++; return "id"; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(writeCount).toBe(0);
    expect(processor.getStats().eventsDeduplicated).toBe(1);
  });

  test("increments eventsErrored for invalid lines", async () => {
    const store = mockStore();
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine("not valid json at all");
    await Bun.sleep(10);

    expect(processor.getStats().eventsErrored).toBe(1);
    expect(processor.getStats().eventsProcessed).toBe(0);
  });

  test("handles memory_delete event type", async () => {
    let deletedId: string | null = null;
    const store = mockStore({
      delete: async (id) => { deletedId = id; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ type: "memory_delete" }));
    await Bun.sleep(10);

    expect(deletedId).toBe("entry-1");
  });

  test("handles sync event type", async () => {
    let committed: { tenantId: string; message: string } | null = null;
    const store = mockStore({
      commit: async (tenantId, message) => { committed = { tenantId, message }; },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ type: "sync" }));
    await Bun.sleep(10);

    expect(committed).not.toBeNull();
    expect(committed!.tenantId).toBe("tenant-1");
  });

  test("flushes batch at size threshold", async () => {
    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    processor = new EventProcessor({ store, batchSize: 3, flushIntervalMs: 60000 });

    // Add 2 events — should not flush yet
    await processor.processLine(validLine());
    await processor.processLine(validLine());
    await Bun.sleep(10);
    expect(writeCount).toBe(0);

    // 3rd event hits threshold — should flush
    await processor.processLine(validLine());
    await Bun.sleep(10);
    expect(writeCount).toBe(3);
  });

  test("flushes batch at time threshold", async () => {
    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    processor = new EventProcessor({ store, batchSize: 100, flushIntervalMs: 50 });
    processor.startFlushTimer();

    await processor.processLine(validLine());
    expect(writeCount).toBe(0);

    await Bun.sleep(100);
    expect(writeCount).toBe(1);
  });

  test("getStats returns accurate counts", async () => {
    const store = mockStore({
      deduplicateCheck: async (content) => content === "duplicate",
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    // 1 valid write
    await processor.processLine(validLine());
    await Bun.sleep(10);

    // 1 duplicate
    await processor.processLine(validLine({
      entry: { id: "e2", tenantId: "tenant-1", category: "fact", content: "duplicate", source: "s", createdAt: "2024-01-01T00:00:00Z" },
    }));
    await Bun.sleep(10);

    // 1 invalid
    await processor.processLine("garbage");
    await Bun.sleep(10);

    const stats = processor.getStats();
    expect(stats.eventsProcessed).toBe(1);
    expect(stats.eventsDeduplicated).toBe(1);
    expect(stats.eventsErrored).toBe(1);
  });

  test("store errors do not crash processor", async () => {
    const store = mockStore({
      write: async () => { throw new Error("store down"); },
    });
    processor = new EventProcessor({ store, batchSize: 1, flushIntervalMs: 60000 });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(processor.getStats().eventsErrored).toBe(1);
  });

  test("calls onEvent handler for processed events", async () => {
    const events: unknown[] = [];
    const store = mockStore();
    processor = new EventProcessor({
      store,
      batchSize: 1,
      flushIntervalMs: 60000,
      onEvent: async (event) => { events.push(event); },
    });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(events).toHaveLength(1);
  });

  test("does not call onEvent handler for deduplicated events", async () => {
    const events: unknown[] = [];
    const store = mockStore({ deduplicateCheck: async () => true });
    processor = new EventProcessor({
      store,
      batchSize: 1,
      flushIntervalMs: 60000,
      onEvent: async (event) => { events.push(event); },
    });

    await processor.processLine(validLine());
    await Bun.sleep(10);

    expect(events).toHaveLength(0);
  });

  test("commits once per unique tenantId in batch", async () => {
    const commits: string[] = [];
    const store = mockStore({
      commit: async (tenantId) => { commits.push(tenantId); },
    });
    processor = new EventProcessor({ store, batchSize: 3, flushIntervalMs: 60000 });

    await processor.processLine(validLine({ tenantId: "t1" }));
    await processor.processLine(validLine({ tenantId: "t1" }));
    await processor.processLine(validLine({ tenantId: "t2" }));
    await Bun.sleep(10);

    // Should commit once for t1 and once for t2
    expect(commits).toContain("t1");
    expect(commits).toContain("t2");
    expect(commits).toHaveLength(2);
  });
});
