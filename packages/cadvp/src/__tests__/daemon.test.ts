import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CadvpDaemon } from "../daemon.ts";
import type { MemoryStore, CadvpEvent } from "@sockt/types";

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
      content: "Test content",
      source: "agent:monitor",
      createdAt: "2024-06-01T14:00:00Z",
    },
    timestamp: "2024-06-01T14:00:01Z",
    ...overrides,
  });
}

describe("CadvpDaemon", () => {
  let dir: string;
  let daemon: CadvpDaemon;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-daemon-"));
  });

  afterEach(async () => {
    await daemon?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("start begins watching and processes events", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({ write: async () => { writeCount++; return "id"; } });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);

    expect(writeCount).toBe(1);
  });

  test("stop drains remaining events", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({ write: async () => { writeCount++; return "id"; } });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 100, // large batch — won't flush until stop
      pollIntervalMs: 30,
      flushIntervalMs: 60000,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);

    // Not flushed yet due to large batch
    expect(writeCount).toBe(0);

    await daemon.stop();
    expect(writeCount).toBe(1);
  });

  test("onEvent handler receives processed events", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const events: CadvpEvent[] = [];
    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });
    daemon.onEvent(async (event) => { events.push(event); });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("memory_write");
  });

  test("getStats delegates to processor", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);

    const stats = daemon.getStats();
    expect(stats.eventsProcessed).toBe(1);
    expect(stats.eventsDeduplicated).toBe(0);
    expect(stats.eventsErrored).toBe(0);
  });

  test("stop is idempotent", async () => {
    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      pollIntervalMs: 30,
    });

    await daemon.start([]);
    await daemon.stop();
    // Second stop should not throw
    await daemon.stop();
  });

  test("handles multiple onEvent handlers", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const calls1: number[] = [];
    const calls2: number[] = [];
    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });
    daemon.onEvent(async () => { calls1.push(1); });
    daemon.onEvent(async () => { calls2.push(1); });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);

    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  test("persists checkpoint on stop", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const store = mockStore();
    const ckptPath = join(dir, "ckpt.json");
    daemon = new CadvpDaemon({
      store,
      checkpointPath: ckptPath,
      batchSize: 1,
      pollIntervalMs: 30,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, validLine() + "\n");
    await Bun.sleep(100);
    await daemon.stop();

    // Checkpoint should exist with offset > 0
    const ckpt = await Bun.file(ckptPath).json();
    expect(ckpt[filePath]).toBeGreaterThan(0);
  });
});
