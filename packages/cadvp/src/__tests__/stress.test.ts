import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CadvpDaemon } from "../daemon.ts";
import type { MemoryStore } from "@sockt/types";

function mockStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    write: async () => "id",
    search: async () => [],
    deduplicateCheck: async () => false,
    commit: async () => {},
    listCategories: async () => [],
    delete: async () => {},
    ...overrides,
  };
}

function eventLine(content: string, tenantId = "t1"): string {
  return JSON.stringify({
    type: "memory_write",
    tenantId,
    agentId: "agent-stress",
    entry: {
      id: crypto.randomUUID(),
      tenantId,
      category: "fact",
      content,
      source: "agent:stress",
      createdAt: "2024-06-01T00:00:00Z",
    },
    timestamp: "2024-06-01T00:00:01Z",
  });
}

describe("Stress tests", () => {
  let dir: string;
  let daemon: CadvpDaemon;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-stress-"));
  });

  afterEach(async () => {
    await daemon?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("handles 500 events written in a single burst", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 50,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start([filePath]);

    // Write 500 lines in one burst
    let content = "";
    for (let i = 0; i < 500; i++) {
      content += eventLine(`stress event ${i}`) + "\n";
    }
    await appendFile(filePath, content);
    await Bun.sleep(1000);

    expect(writeCount).toBe(500);
    expect(daemon.getStats().eventsProcessed).toBe(500);
  }, 5000);

  test("handles interleaved writes across 10 files", async () => {
    const files = Array.from({ length: 10 }, (_, i) => join(dir, `agent-${i}.jsonl`));
    for (const f of files) await writeFile(f, "");

    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 10,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start(files);

    // Each file gets 10 events
    for (const f of files) {
      let content = "";
      for (let i = 0; i < 10; i++) {
        content += eventLine(`from ${f} event ${i}`) + "\n";
      }
      await appendFile(f, content);
    }
    await Bun.sleep(1000);

    expect(writeCount).toBe(100);
  }, 5000);

  test("handles slow store without losing events", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({
      write: async () => {
        await Bun.sleep(5); // 5ms per write
        writeCount++;
        return "id";
      },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 10,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start([filePath]);

    let content = "";
    for (let i = 0; i < 50; i++) {
      content += eventLine(`slow store event ${i}`) + "\n";
    }
    await appendFile(filePath, content);
    await Bun.sleep(1500); // 50 * 5ms = 250ms minimum, plus batch overhead

    expect(writeCount).toBe(50);
  }, 5000);

  test("handles mixed valid/invalid at high volume", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 20,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start([filePath]);

    // 100 lines: 70 valid, 30 garbage
    let content = "";
    for (let i = 0; i < 100; i++) {
      if (i % 10 < 7) {
        content += eventLine(`valid ${i}`) + "\n";
      } else {
        content += `invalid json line ${i}\n`;
      }
    }
    await appendFile(filePath, content);
    await Bun.sleep(800);

    expect(writeCount).toBe(70);
    expect(daemon.getStats().eventsProcessed).toBe(70);
    expect(daemon.getStats().eventsErrored).toBe(30);
  }, 5000);

  test("restart cycle preserves total event count", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");
    const ckptPath = join(dir, "ckpt.json");

    const store = mockStore();
    let totalWrites = 0;

    // 5 restart cycles, 20 events each
    for (let cycle = 0; cycle < 5; cycle++) {
      let cycleWrites = 0;
      const cycleStore = mockStore({
        write: async () => { cycleWrites++; totalWrites++; return "id"; },
      });

      const d = new CadvpDaemon({
        store: cycleStore,
        checkpointPath: ckptPath,
        batchSize: 5,
        pollIntervalMs: 20,
        flushIntervalMs: 50,
      });

      await d.start([filePath]);

      let content = "";
      for (let i = 0; i < 20; i++) {
        content += eventLine(`cycle ${cycle} event ${i}`) + "\n";
      }
      await appendFile(filePath, content);
      await Bun.sleep(300);
      await d.stop();

      expect(cycleWrites).toBe(20);
    }

    expect(totalWrites).toBe(100);
  }, 10000);

  test("handles many tenants without cross-contamination", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const tenantWrites = new Map<string, number>();
    const store = mockStore({
      write: async (entry) => {
        const tid = (entry as { tenantId: string }).tenantId;
        tenantWrites.set(tid, (tenantWrites.get(tid) ?? 0) + 1);
        return "id";
      },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 10,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start([filePath]);

    // 10 tenants, 10 events each
    let content = "";
    for (let t = 0; t < 10; t++) {
      for (let i = 0; i < 10; i++) {
        content += eventLine(`tenant-${t} event ${i}`, `tenant-${t}`) + "\n";
      }
    }
    await appendFile(filePath, content);
    await Bun.sleep(800);

    for (let t = 0; t < 10; t++) {
      expect(tenantWrites.get(`tenant-${t}`)).toBe(10);
    }
  }, 5000);

  test("handles rapid start/stop cycles", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const store = mockStore();

    // Rapid start/stop 10 times without data — should not throw
    for (let i = 0; i < 10; i++) {
      const d = new CadvpDaemon({
        store,
        checkpointPath: join(dir, "ckpt.json"),
        batchSize: 10,
        pollIntervalMs: 30,
      });
      await d.start([filePath]);
      await d.stop();
    }
  });

  test("large lines (100KB each) are processed correctly", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    let writeCount = 0;
    const store = mockStore({
      write: async () => { writeCount++; return "id"; },
    });
    daemon = new CadvpDaemon({
      store,
      checkpointPath: join(dir, "ckpt.json"),
      batchSize: 5,
      pollIntervalMs: 20,
      flushIntervalMs: 50,
    });

    await daemon.start([filePath]);

    let content = "";
    for (let i = 0; i < 5; i++) {
      content += eventLine("x".repeat(100_000)) + "\n";
    }
    await appendFile(filePath, content);
    await Bun.sleep(500);

    expect(writeCount).toBe(5);
  }, 5000);
});
