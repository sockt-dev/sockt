import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CadvpDaemon } from "../daemon.ts";
import type { MemoryStore, CadvpEvent } from "@sockt/types";

function mockStore(overrides: Partial<MemoryStore> = {}): MemoryStore & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    write: [],
    deduplicateCheck: [],
    commit: [],
    delete: [],
  };
  return {
    calls,
    write: async (...args: unknown[]) => { calls.write!.push(args); return "id-" + calls.write!.length; },
    search: async () => [],
    deduplicateCheck: async (...args: unknown[]) => { calls.deduplicateCheck!.push(args); return false; },
    commit: async (...args: unknown[]) => { calls.commit!.push(args); },
    listCategories: async () => [],
    delete: async (...args: unknown[]) => { calls.delete!.push(args); },
    ...overrides,
  } as MemoryStore & { calls: Record<string, unknown[][]> };
}

function eventLine(content: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "memory_write",
    tenantId: "tenant-1",
    agentId: "agent-monitor",
    entry: {
      id: crypto.randomUUID(),
      tenantId: "tenant-1",
      category: "fact",
      content,
      source: "agent:monitor",
      createdAt: "2024-06-01T14:00:00Z",
    },
    timestamp: "2024-06-01T14:00:01Z",
    ...overrides,
  });
}

describe("Integration", () => {
  let dir: string;
  let daemon: CadvpDaemon;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-integration-"));
  });

  afterEach(async () => {
    await daemon?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("end-to-end: JSONL append triggers memory write", async () => {
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
    await appendFile(filePath, eventLine("Server is healthy") + "\n");
    await Bun.sleep(100);

    expect(store.calls.write).toHaveLength(1);
    const written = store.calls.write[0]![0] as Record<string, unknown>;
    expect(written.content).toBe("Server is healthy");
  });

  test("end-to-end: duplicate events are filtered", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let checkCount = 0;
    const store = mockStore({
      deduplicateCheck: async () => {
        checkCount++;
        return checkCount > 1; // First is novel, rest are duplicates
      },
    });
    daemon = new CadvpDaemon({
      store: store as unknown as MemoryStore,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, eventLine("same content") + "\n");
    await Bun.sleep(100);
    await appendFile(filePath, eventLine("same content") + "\n");
    await Bun.sleep(100);

    const stats = daemon.getStats();
    expect(stats.eventsProcessed).toBe(1);
    expect(stats.eventsDeduplicated).toBe(1);
  });

  test("end-to-end: checkpoint resume skips processed lines", async () => {
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

    // Process 2 events
    await daemon.start([filePath]);
    await appendFile(filePath, eventLine("event 1") + "\n");
    await appendFile(filePath, eventLine("event 2") + "\n");
    await Bun.sleep(150);
    await daemon.stop();

    expect(store.calls.write).toHaveLength(2);

    // Append more, then restart
    await appendFile(filePath, eventLine("event 3") + "\n");

    const store2 = mockStore();
    const daemon2 = new CadvpDaemon({
      store: store2,
      checkpointPath: ckptPath,
      batchSize: 1,
      pollIntervalMs: 30,
    });
    daemon = daemon2; // for cleanup in afterEach

    await daemon2.start([filePath]);
    await Bun.sleep(100);

    // Should only process event 3
    expect(store2.calls.write).toHaveLength(1);
    const written = store2.calls.write[0]![0] as Record<string, unknown>;
    expect(written.content).toBe("event 3");
  });

  test("end-to-end: mixed valid and invalid lines", async () => {
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
    await appendFile(filePath, eventLine("valid 1") + "\n");
    await appendFile(filePath, "not valid json\n");
    await appendFile(filePath, eventLine("valid 2") + "\n");
    await Bun.sleep(150);

    const stats = daemon.getStats();
    expect(stats.eventsProcessed).toBe(2);
    expect(stats.eventsErrored).toBe(1);
  });

  test("end-to-end: multiple watched files", async () => {
    const fileA = join(dir, "monitor.jsonl");
    const fileB = join(dir, "researcher.jsonl");
    await writeFile(fileA, "");
    await writeFile(fileB, "");

    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 1,
      pollIntervalMs: 30,
    });

    await daemon.start([fileA, fileB]);
    await appendFile(fileA, eventLine("from monitor") + "\n");
    await appendFile(fileB, eventLine("from researcher") + "\n");
    await Bun.sleep(150);

    expect(store.calls.write).toHaveLength(2);
    const contents = store.calls.write.map((args) => (args[0] as Record<string, unknown>).content);
    expect(contents).toContain("from monitor");
    expect(contents).toContain("from researcher");
  });

  test("end-to-end: batch flush on timeout", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const store = mockStore();
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 100, // large — won't hit size threshold
      flushIntervalMs: 60,
      pollIntervalMs: 30,
    });

    await daemon.start([filePath]);
    await appendFile(filePath, eventLine("waiting for timer") + "\n");
    await Bun.sleep(50);

    // Not flushed yet
    expect(store.calls.write).toHaveLength(0);

    // Wait for timer
    await Bun.sleep(80);
    expect(store.calls.write).toHaveLength(1);
  });

  test("end-to-end: memory_delete routes to store.delete", async () => {
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
    const line = JSON.stringify({
      type: "memory_delete",
      tenantId: "tenant-1",
      agentId: "agent-monitor",
      entry: {
        id: "to-delete",
        tenantId: "tenant-1",
        category: "fact",
        content: "outdated fact",
        source: "agent:monitor",
        createdAt: "2024-06-01T14:00:00Z",
      },
      timestamp: "2024-06-01T15:00:00Z",
    });
    await appendFile(filePath, line + "\n");
    await Bun.sleep(100);

    expect(store.calls.delete).toHaveLength(1);
    expect(store.calls.delete[0]![0]).toBe("to-delete");
  });
});
