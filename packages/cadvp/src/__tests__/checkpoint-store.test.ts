import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckpointStore } from "../checkpoint-store.ts";

describe("CheckpointStore", () => {
  let dir: string;
  let store: CheckpointStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-ckpt-"));
    store = new CheckpointStore(join(dir, "offsets.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("getOffset returns 0 for unknown path", () => {
    expect(store.getOffset("/unknown/file.jsonl")).toBe(0);
  });

  test("setOffset stores and getOffset retrieves", () => {
    store.setOffset("/watch/monitor/events.jsonl", 1024);
    expect(store.getOffset("/watch/monitor/events.jsonl")).toBe(1024);
  });

  test("multiple paths are independent", () => {
    store.setOffset("/watch/a/events.jsonl", 100);
    store.setOffset("/watch/b/events.jsonl", 200);
    expect(store.getOffset("/watch/a/events.jsonl")).toBe(100);
    expect(store.getOffset("/watch/b/events.jsonl")).toBe(200);
  });

  test("flush persists offsets to disk", async () => {
    store.setOffset("/watch/monitor/events.jsonl", 512);
    await store.flush();

    const raw = await Bun.file(join(dir, "offsets.json")).json();
    expect(raw).toEqual({ "/watch/monitor/events.jsonl": 512 });
  });

  test("load restores previously flushed offsets", async () => {
    store.setOffset("/watch/a/events.jsonl", 100);
    store.setOffset("/watch/b/events.jsonl", 200);
    await store.flush();

    const store2 = new CheckpointStore(join(dir, "offsets.json"));
    await store2.load();
    expect(store2.getOffset("/watch/a/events.jsonl")).toBe(100);
    expect(store2.getOffset("/watch/b/events.jsonl")).toBe(200);
  });

  test("load with no checkpoint file starts fresh", async () => {
    const store2 = new CheckpointStore(join(dir, "nonexistent.json"));
    await store2.load();
    expect(store2.getOffset("/any")).toBe(0);
  });

  test("load survives corrupted checkpoint file", async () => {
    await Bun.write(join(dir, "offsets.json"), "not valid json{{{");
    const store2 = new CheckpointStore(join(dir, "offsets.json"));
    await store2.load();
    expect(store2.getOffset("/any")).toBe(0);
  });

  test("setOffset overwrites previous value", () => {
    store.setOffset("/file.jsonl", 100);
    store.setOffset("/file.jsonl", 999);
    expect(store.getOffset("/file.jsonl")).toBe(999);
  });

  test("flush uses atomic write (temp + rename)", async () => {
    store.setOffset("/file.jsonl", 42);
    await store.flush();

    // Verify the file exists and is valid — if atomic write works,
    // there should be no .tmp file left over
    const exists = await Bun.file(join(dir, "offsets.json")).exists();
    expect(exists).toBe(true);

    const tmpExists = await Bun.file(join(dir, "offsets.json.tmp")).exists();
    expect(tmpExists).toBe(false);
  });
});
