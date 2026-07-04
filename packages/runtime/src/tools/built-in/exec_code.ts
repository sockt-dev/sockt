/**
 * exec_code tool — runs code snippets in an isolated Docker AI Sandbox (sbx).
 * If sbx is not available, falls back to a restricted Bun.spawn in a temp dir.
 *
 * Supported languages: python, javascript, typescript, bash, sh
 */

import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";
import { SbxSandbox, checkSbxAvailable } from "../../sandbox/sbx-sandbox.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const execCodeDefinition: ToolDefinition = {
  name: "exec_code",
  description: "Execute a code snippet in an isolated Docker AI Sandbox. Use for running scripts, testing logic, installing packages, or any computation that needs isolation. Supports python, javascript, typescript, bash.",
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description: "Language: python | javascript | typescript | bash | sh",
      },
      code: {
        type: "string",
        description: "The code to execute",
      },
      sandbox_name: {
        type: "string",
        description: "Optional: reuse an existing named sandbox (e.g. from a previous exec_code call)",
      },
      timeout_ms: {
        type: "number",
        description: "Execution timeout in milliseconds (default 30000)",
      },
    },
    required: ["language", "code"],
  },
};

export const makeExecCodeHandler = (agentId: string): ToolHandler =>
  async (args) => {
    const language    = String(args.language ?? "bash").toLowerCase();
    const code        = String(args.code ?? "");
    const sandboxName = args.sandbox_name ? String(args.sandbox_name) : undefined;
    const timeoutMs   = Number(args.timeout_ms ?? 30_000);

    const { cmd, ext } = resolveRuntime(language);
    if (!cmd) {
      throw new Error(`Unsupported language: ${language}. Use python, javascript, typescript, bash, or sh.`);
    }

    const sbxAvailable = await checkSbxAvailable();

    if (sbxAvailable) {
      return execInSbx(code, cmd, ext, agentId, sandboxName, timeoutMs);
    }

    // Fallback: run in restricted temp dir (no microVM isolation)
    console.warn("[exec_code] sbx not available — running in temp dir (no microVM isolation)");
    return execInTempDir(code, cmd, ext, timeoutMs);
  };

/* ── sbx execution ──────────────────────────────────────────────────── */

async function execInSbx(
  code: string,
  cmd: string,
  ext: string,
  agentId: string,
  sandboxName: string | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const sbx = new SbxSandbox();
  const name = sandboxName ?? `sockt-${agentId}-exec`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);

  // Create sandbox if it doesn't exist
  const running = await sbx.listRunning();
  const exists = running.some(s => s.id === name);

  if (!exists) {
    await sbx.create({
      agentId: name,
      tenantId: "exec",
      envVars: {},
    });
  }

  // Write code file into sandbox using echo/heredoc
  const filename = `/tmp/agent_code_${Date.now()}.${ext}`;
  const escapedCode = code.replace(/'/g, "'\"'\"'");
  await sbx.exec(name, ["sh", "-c", `printf '%s' '${escapedCode}' > ${filename}`]);

  // Execute with timeout
  const result = await Promise.race([
    sbx.exec(name, [cmd, filename]),
    timeout(timeoutMs),
  ]);

  // Clean up code file (not the sandbox — it's reusable)
  await sbx.exec(name, ["rm", "-f", filename]).catch(() => {});

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    sandbox: name,
    isolated: true,
  };
}

/* ── fallback: temp dir ─────────────────────────────────────────────── */

async function execInTempDir(
  code: string,
  cmd: string,
  ext: string,
  timeoutMs: number,
): Promise<unknown> {
  const dir      = join(tmpdir(), `sockt-exec-${Date.now()}`);
  const filepath = join(dir, `code.${ext}`);

  await Bun.write(filepath, code);

  const proc = Bun.spawn([cmd, filepath], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      // Intentionally minimal env for safety
    },
  });

  const [stdout, stderr, exitCode] = await Promise.race([
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]),
    timeout(timeoutMs).then(() => {
      proc.kill();
      throw new Error(`Code execution timed out after ${timeoutMs}ms`);
    }),
  ]);

  // Clean up temp dir
  await Bun.spawn(["rm", "-rf", dir], { stdout: "pipe", stderr: "pipe" }).exited.catch(() => {});

  return {
    exitCode,
    stdout: (stdout as string).trim(),
    stderr: (stderr as string).trim(),
    isolated: false,
    warning: "sbx not available — ran in temp dir without microVM isolation",
  };
}

/* ── helpers ────────────────────────────────────────────────────────── */

function resolveRuntime(language: string): { cmd: string; ext: string } {
  switch (language) {
    case "python":
    case "py":
      return { cmd: "python3", ext: "py" };
    case "javascript":
    case "js":
      return { cmd: "node", ext: "js" };
    case "typescript":
    case "ts":
      return { cmd: "bun", ext: "ts" };
    case "bash":
      return { cmd: "bash", ext: "sh" };
    case "sh":
      return { cmd: "sh", ext: "sh" };
    default:
      return { cmd: "", ext: "" };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`exec_code timed out after ${ms}ms`)), ms),
  );
}
