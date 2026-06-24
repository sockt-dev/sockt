import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlTailer } from "../jsonl-tailer.ts";
import { CheckpointStore } from "../checkpoint-store.ts";

describe("JsonlTailer", () => {
  let dir: string;
  let checkpoint: CheckpointStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cadvp-tailer-"));
    checkpoint = new CheckpointStore(join(dir, "ckpt.json"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("emits lines when appended to a watched file", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    await appendFile(filePath, '{"type":"memory_write"}\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"type":"memory_write"}');
    await tailer.stop();
  });

  test("emits multiple lines for multi-line append", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    await appendFile(filePath, '{"line":1}\n{"line":2}\n{"line":3}\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(3);
    await tailer.stop();
  });

  test("buffers partial lines until newline arrives", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    // Write partial (no newline)
    await appendFile(filePath, '{"partial":"true"');
    await Bun.sleep(80);
    expect(lines).toHaveLength(0);

    // Complete the line
    await appendFile(filePath, '}\n');
    await Bun.sleep(80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"partial":"true"}');
    await tailer.stop();
  });

  test("resumes from checkpoint offset", async () => {
    const filePath = join(dir, "events.jsonl");
    // Pre-write 2 lines
    await writeFile(filePath, '{"line":1}\n{"line":2}\n');

    // Set checkpoint past line 1
    const line1Bytes = Buffer.byteLength('{"line":1}\n', "utf-8");
    checkpoint.setOffset(filePath, line1Bytes);

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));
    await Bun.sleep(80);

    // Should only see line 2
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"line":2}');
    await tailer.stop();
  });

  test("watches multiple files simultaneously", async () => {
    const fileA = join(dir, "a.jsonl");
    const fileB = join(dir, "b.jsonl");
    await writeFile(fileA, "");
    await writeFile(fileB, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([fileA, fileB], (line) => lines.push(line));

    await appendFile(fileA, '{"from":"a"}\n');
    await appendFile(fileB, '{"from":"b"}\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(2);
    expect(lines).toContain('{"from":"a"}');
    expect(lines).toContain('{"from":"b"}');
    await tailer.stop();
  });

  test("stop ceases watching", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));
    await tailer.stop();

    await appendFile(filePath, '{"after":"stop"}\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(0);
  });

  test("skips empty lines", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));

    await appendFile(filePath, '\n\n{"real":"line"}\n\n');
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"real":"line"}');
    await tailer.stop();
  });

  test("updates checkpoint offsets after processing", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, "");

    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], () => {});

    await appendFile(filePath, '{"line":1}\n');
    await Bun.sleep(80);

    const expectedOffset = Buffer.byteLength('{"line":1}\n', "utf-8");
    expect(checkpoint.getOffset(filePath)).toBe(expectedOffset);
    await tailer.stop();
  });

  test("reads existing content from offset 0 on start", async () => {
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, '{"existing":true}\n');

    const lines: string[] = [];
    const tailer = new JsonlTailer({ checkpointStore: checkpoint, pollIntervalMs: 30 });
    await tailer.start([filePath], (line) => lines.push(line));
    await Bun.sleep(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('{"existing":true}');
    await tailer.stop();
  });
});
