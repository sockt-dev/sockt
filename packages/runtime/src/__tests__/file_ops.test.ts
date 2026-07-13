import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { writeFileHandler, readFileHandler } from "../tools/built-in/file_ops.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("write_file / read_file", () => {
  let scratchDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "sockt-file-ops-test-"));
    process.env.SCRATCH_DIR = scratchDir;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(scratchDir, { recursive: true, force: true });
  });

  test("writes and reads back a plain file", async () => {
    await writeFileHandler({ filename: "report.md", content: "hello world" });
    const result = await readFileHandler({ filename: "report.md" }) as { content: string };
    expect(result.content).toBe("hello world");
  });

  test("append mode adds to existing content instead of overwriting", async () => {
    await writeFileHandler({ filename: "log.txt", content: "line1\n" });
    await writeFileHandler({ filename: "log.txt", content: "line2\n", append: true });
    const result = await readFileHandler({ filename: "log.txt" }) as { content: string };
    expect(result.content).toBe("line1\nline2\n");
  });

  test("rejects a path-traversal filename on write instead of escaping the scratch directory", async () => {
    await expect(writeFileHandler({ filename: "../../../../evil.txt", content: "pwned" }))
      .rejects.toThrow(/outside the scratch directory/);
  });

  test("rejects a path-traversal filename on read instead of escaping the scratch directory", async () => {
    await expect(readFileHandler({ filename: "../../../../etc/passwd" }))
      .rejects.toThrow(/outside the scratch directory/);
  });

  test("rejects an absolute-path-shaped traversal that still resolves outside the scratch dir", async () => {
    // Even though "/" survives the character allowlist, this must still be
    // caught by the containment check, not just the (irrelevant on its own)
    // character filter.
    await expect(writeFileHandler({ filename: "../outside.txt", content: "x" }))
      .rejects.toThrow(/outside the scratch directory/);
  });

  test("allows a filename with a legitimate subdirectory inside the scratch dir", async () => {
    await writeFileHandler({ filename: "reports/q1.md", content: "data" });
    const result = await readFileHandler({ filename: "reports/q1.md" }) as { content: string };
    expect(result.content).toBe("data");
  });

  test("read_file throws a not-found error for a missing file", async () => {
    await expect(readFileHandler({ filename: "does-not-exist.txt" })).rejects.toThrow(/not found/i);
  });
});
