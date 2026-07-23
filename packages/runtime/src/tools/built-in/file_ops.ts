import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { appendFile, readFile, writeFile } from "node:fs/promises";

// process.env.HOME is unset on Windows — the old `process.env.HOME ?? "~"`
// fallback left files landing in a literal "~" directory under cwd instead
// of the user's actual home, silently splitting scratch files across
// whatever directory the process happened to be launched from.
const scratchDir = () =>
  process.env.SCRATCH_DIR ?? join(homedir(), ".sockt", "scratch", "files");

async function ensureDir(dir: string) {
  await Bun.write(Bun.file(join(dir, ".keep")), "").catch(() => {});
}

// The character allowlist below only strips characters outside
// [a-zA-Z0-9._-/] — it does NOT stop ".." path segments, so a filename like
// "../../../../etc/passwd" survives untouched and `join(dir, filename)`
// escapes the scratch directory entirely (arbitrary write via write_file,
// arbitrary read via read_file). Resolve the path and verify it's still
// contained within `dir` before ever touching the filesystem.
function resolveScratchPath(dir: string, rawFilename: string): string {
  const sanitized = String(rawFilename).replace(/[^a-zA-Z0-9._\-\/]/g, "_");
  const resolvedDir = resolve(dir);
  const resolvedPath = resolve(resolvedDir, sanitized);
  if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + sep)) {
    throw new Error(`Invalid filename: "${rawFilename}" resolves outside the scratch directory`);
  }
  return resolvedPath;
}

/* ── write_file ─────────────────────────────────────────────────────────── */

export const writeFileDefinition: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file in the agent scratch directory. Use for drafts, reports, specs, RCAs.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "File name (e.g. 'outreach_draft.md')" },
      content: { type: "string", description: "Full text content to write" },
      append: { type: "boolean", description: "Append to existing file instead of overwriting" },
    },
    required: ["filename", "content"],
  },
};

export const writeFileHandler: ToolHandler = async (args) => {
  const filename = String(args.filename ?? "output.txt");
  const content  = String(args.content ?? "");
  const append   = Boolean(args.append ?? false);
  const dir      = scratchDir();

  await ensureDir(dir);
  const path = resolveScratchPath(dir, filename);

  if (append) {
    await appendFile(path, content, "utf8");
  } else {
    await writeFile(path, content, "utf8");
  }

  return { written: path, bytes: content.length, append };
};

/* ── read_file ──────────────────────────────────────────────────────────── */

export const readFileDefinition: ToolDefinition = {
  name: "read_file",
  description: "Read the content of a file from the agent scratch directory.",
  parameters: {
    type: "object",
    properties: {
      filename: { type: "string", description: "File name to read" },
    },
    required: ["filename"],
  },
};

export const readFileHandler: ToolHandler = async (args) => {
  const filename = String(args.filename ?? "");
  const path = resolveScratchPath(scratchDir(), filename);
  const file = Bun.file(path);

  if (!await file.exists()) {
    throw new Error(`File not found: ${filename}`);
  }

  const content = await file.text();
  return { filename, content, bytes: content.length };
};
