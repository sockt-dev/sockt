import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";
import { join } from "node:path";

const scratchDir = () =>
  process.env.SCRATCH_DIR ?? join(process.env.HOME ?? "~", ".sockt", "scratch", "files");

async function ensureDir(dir: string) {
  await Bun.write(Bun.file(join(dir, ".keep")), "").catch(() => {});
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
  const filename = String(args.filename ?? "output.txt").replace(/[^a-zA-Z0-9._\-\/]/g, "_");
  const content  = String(args.content ?? "");
  const append   = Boolean(args.append ?? false);
  const dir      = scratchDir();

  await ensureDir(dir);
  const path = join(dir, filename);

  if (append) {
    const existing = await Bun.file(path).text().catch(() => "");
    await Bun.write(path, existing + content);
  } else {
    await Bun.write(path, content);
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
  const filename = String(args.filename ?? "").replace(/[^a-zA-Z0-9._\-\/]/g, "_");
  const path = join(scratchDir(), filename);
  const file = Bun.file(path);

  if (!await file.exists()) {
    throw new Error(`File not found: ${filename}`);
  }

  const content = await file.text();
  return { filename, content, bytes: content.length };
};
