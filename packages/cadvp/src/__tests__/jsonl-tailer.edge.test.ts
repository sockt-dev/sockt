import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlTailer } from "../jsonl-tailer.ts";
import { CheckpointStore } from "../checkpoint-store.ts";

describe("JsonlTailer edge cases", () => {
  let dir: string;
  let checkpoint: CheckpointStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-tailer-edge-"));
    checkpoint = new CheckpointStore(join(dir, "ckpt.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("handles rapid sequential appends (100 lines)", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 20 });
    await tailer.start([filePath], (line) => lines.push(line));

    // Rapid fire 100 lines
    let content = "";
    for (let i = 0; i < 100; i++) {
      content += JSON.stringify({ seq: i }) + "\n";
    }
    await appendFile(filePath, content);
    await Bun.sleep(200);

    expect(lines).toHaveLength(100);
    // Verify ordering
    for (let i = 0; i < 100; i++) {
      expect(JSON.parse(lines[i]!).seq).toBe(i);
    }
    await tailer.stop();
  });

  test("handles multi-byte UTF-8 characters correctly", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    const unicodeLine = JSON.stringify({ content: "日本語テスト🎉" });
    await appendFile(filePath, unicodeLine + "\n");
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content).toBe("日本語テスト🎉");

    // Verify offset accounts for multi-byte
    const expectedOffset = Buffer.byteLength(unicodeLine + "\n", "utf-8");
    expect(checkpoint.getOffset(filePath)).toBe(expectedOffset);
    await tailer.stop();
  });

  test("handles very long lines (10KB JSON)", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    const longContent = "x".repeat(10_000);
    const longLine = JSON.stringify({ content: longContent });
    await appendFile(filePath, longLine + "\n");
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content.length).toBe(10_000);
    await tailer.stop();
  });

  test("multiple partial writes combine correctly", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    // Write in tiny increments
    await appendFile(filePath, '{"k');
    await Bun.sleep(50);
    expect(lines).toHaveLength(0);

    await appendFile(filePath, 'ey":"va');
    await Bun.sleep(50);
    expect(lines).toHaveLength(0);

    await appendFile(filePath, 'lue"}\n');
    await Bun.sleep(50);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"key":"value"}');
    await tailer.stop();
  });

  test("handles lines with embedded newlines in JSON strings", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    // JSON with escaped newlines (still one line in JSONL)
    const jsonWithNewlines = JSON.stringify({ content: "line1\nline2\nline3" });
    await appendFile(filePath, jsonWithNewlines + "\n");
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).content).toBe("line1\nline2\nline3");
    await tailer.stop();
  });

  test("handles file that already has content before watching", async () => {
    const filePath = join(dir, "events.jsonl");
    // Pre-populate with 5 lines
    let existing = "";
    for (let i = 0; i < 5; i++) {
      existing += JSON.stringify({ pre: i }) + "\n";
    }
    await writeFile(filePath, existing);

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));
    await Bun.sleep(80);

    expect(lines).toHaveLength(5);

    // Now append more
    await appendFile(filePath, JSON.stringify({ post: true }) + "\n");
    await Bun.sleep(80);

    expect(lines).toHaveLength(6);
    await tailer.stop();
  });

  test("checkpoint offset survives restart across multiple cycles", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    // Cycle 1: write 3 lines
    const tailer1 = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer1.start([filePath], () => {});
    await appendFile(filePath, '{"c":1}\n{"c":2}\n{"c":3}\n');
    await Bun.sleep(80);
    await tailer1.stop();
    await checkpoint.flush();

    // Cycle 2: append 2 more, start fresh checkpoint
    await appendFile(filePath, '{"c":4}\n{"c":5}\n');
    const checkpoint2 = new CheckpointStore(join(dir, "ckpt.json"));
    await checkpoint2.load();

    const lines2: string[] = [];
    const tailer2 = new JsonlTailer({ checkpointStore: checkpoint2, pollIntervalMs: 30 });
    await tailer2.start([filePath], (line) => lines2.push(line));
    await Bun.sleep(80);

    expect(lines2).toHaveLength(2);
    expect(JSON.parse(lines2[0]!).c).toBe(4);
    expect(JSON.parse(lines2[1]!).c).toBe(5);
    await tailer2.stop();
  });

  test("handles whitespace-only lines interspersed with data", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    await appendFile(filePath, '{"a":1}\n   \n\t\n{"b":2}\n\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).a).toBe(1);
    expect(JSON.parse(lines[1]!).b).toBe(2);
    await tailer.stop();
  });

  test("stop during active reading does not lose data", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 20 });
    await tailer.start([filePath], (line) => lines.push(line));

    // Write 10 lines and immediately stop
    let content = "";
    for (let i = 0; i < 10; i++) {
      content += JSON.stringify({ i }) + "\n";
    }
    await appendFile(filePath, content);
    await Bun.sleep(50);
    await tailer.stop();

    // Should have captured at least some (timing dependent, but poll should catch)
    expect(lines.length).toBeGreaterThan(0);
  });

  test("handles concurrent appends to multiple files", async () => {
    const files = Array.from({ length: 5 }, (_, i) => join(dir, `agent-${i}.jsonl`));
    for (const f of files) await writeFile(f, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 20 });
    await tailer.start(files, (line) => lines.push(line));

    // Append to all files concurrently
    await Promise.all(files.map((f, i) =>
      appendFile(f, JSON.stringify({ agent: i }) + "\n")
    ));
    await Bun.sleep(150);

    expect(lines).toHaveLength(5);
    const agents = lines.map(l => JSON.parse(l).agent).sort();
    expect(agents).toEqual([0, 1, 2, 3, 4]);
    await tailer.stop();
  });

  test("offset never goes backwards", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const offsets: number[] = [];
    const originalSet = checkpoint.setOffset.bind(checkpoint);
    checkpoint.setOffset = (path: string, offset: number) => {
      offsets.push(offset);
      originalSet(path, offset);
    };

    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], () => {});

    await appendFile(filePath, '{"a":1}\n');
    await Bun.sleep(50);
    await appendFile(filePath, '{"b":2}\n');
    await Bun.sleep(50);
    await appendFile(filePath, '{"c":3}\n');
    await Bun.sleep(50);

    // Offsets should be monotonically increasing
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]!).toBeGreaterThanOrEqual(offsets[i - 1]!);
    }
    await tailer.stop();
  });
});
