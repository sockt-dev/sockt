import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckpointStore } from "../checkpoint-store.ts";

describe("CheckpointStore edge cases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-ckpt-edge-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("handles very large offsets (multi-GB files)", () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    const largeOffset = 5_000_000_000; // 5GB
    store.setOffset("/huge/file.jsonl", largeOffset);
    expect(store.getOffset("/huge/file.jsonl")).toBe(largeOffset);
  });

  test("handles many tracked files", async () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    for (let i = 0; i < 500; i++) {
      store.setOffset(`/watch/agent-${i}/events.jsonl`, i * 1024);
    }
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "ckpt.json"));
    await store2.load();
    for (let i = 0; i < 500; i++) {
      expect(store2.getOffset(`/watch/agent-${i}/events.jsonl`)).toBe(i * 1024);
    }
  });

  test("handles file paths with special characters", async () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    const weirdPath = '/watch/agent with spaces/events (1).jsonl';
    store.setOffset(weirdPath, 42);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "ckpt.json"));
    await store2.load();
    expect(store2.getOffset(weirdPath)).toBe(42);
  });

  test("handles unicode file paths", async () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    const unicodePath = "/watch/エージェント/events.jsonl";
    store.setOffset(unicodePath, 100);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "ckpt.json"));
    await store2.load();
    expect(store2.getOffset(unicodePath)).toBe(100);
  });

  test("sequential flushes do not corrupt data", async () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    store.setOffset("/a", 100);
    await store.flush();
    store.setOffset("/b", 200);
    await store.flush();
    store.setOffset("/a", 300);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "ckpt.json"));
    await store2.load();
    expect(store2.getOffset("/a")).toBe(300);
    expect(store2.getOffset("/b")).toBe(200);
  });

  test("flush after setOffset(0) persists zero", async () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    store.setOffset("/file", 1000);
    await store.flush();

    store.setOffset("/file", 0);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "ckpt.json"));
    await store2.load();
    expect(store2.getOffset("/file")).toBe(0);
  });

  test("load with empty JSON object is valid", async () => {
    await Bun.write(join(dir, "ckpt.json"), "{}");
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    await store.load();
    expect(store.getOffset("/any")).toBe(0);
  });

  test("load with JSON array (invalid structure) starts fresh", async () => {
    await Bun.write(join(dir, "ckpt.json"), "[1,2,3]");
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    await store.load();
    expect(store.getOffset("/any")).toBe(0);
  });

  test("load with truncated JSON starts fresh", async () => {
    await Bun.write(join(dir, "ckpt.json"), '{"path":12');
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    await store.load();
    expect(store.getOffset("/any")).toBe(0);
  });

  test("flush creates parent directories if needed", async () => {
    const store = new CheckpointStore(join(dir, "nested", "subdir", "ckpt.json"));
    store.setOffset("/file", 100);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "nested", "subdir", "ckpt.json"));
    await store2.load();
    expect(store2.getOffset("/file")).toBe(100);
  });

  test("rapid setOffset calls preserve last value", () => {
    const store = new CheckpointStore(join(dir, "ckpt.json"));
    for (let i = 0; i < 10000; i++) {
      store.setOffset("/file", i);
    }
    expect(store.getOffset("/file")).toBe(9999);
  });
});
