import { test, expect, describe } from "bun:test";
import { makeExecCodeHandler } from "../tools/built-in/exec_code.ts";

// checkSbxAvailable() spawns the real `sbx` CLI and checks its exit code —
// in a CI/test environment without sbx installed and authenticated, this
// reliably resolves to "unavailable", which is exactly the condition these
// tests exercise (no need to mock it out).
describe("exec_code requireSandbox", () => {
  test("refuses to run when sbx is unavailable and requireSandbox is true", async () => {
    const handler = makeExecCodeHandler("test-agent", true);
    await expect(handler({ language: "bash", code: "echo hi" })).rejects.toThrow(/requires an isolated sandbox/);
  });

  test("falls back to the unsandboxed temp dir when requireSandbox is false (default)", async () => {
    const handler = makeExecCodeHandler("test-agent", false);
    // javascript (node), not bash — on Windows, "bash" resolves to the WSL
    // launcher stub (C:\Windows\System32\bash.exe), not Git Bash, which
    // hangs without a configured WSL distro. Pre-existing quirk in
    // resolveRuntime, unrelated to requireSandbox; sidestepped here rather
    // than fixed, since it's out of scope for this change.
    const result = await handler({ language: "javascript", code: "console.log('hello-from-exec-code')" }) as { isolated: boolean; stdout: string };
    expect(result.isolated).toBe(false);
    expect(result.stdout).toContain("hello-from-exec-code");
  });

  test("requireSandbox defaults to false when omitted", async () => {
    const handler = makeExecCodeHandler("test-agent");
    const result = await handler({ language: "javascript", code: "console.log('default-mode')" }) as { isolated: boolean };
    expect(result.isolated).toBe(false);
  });
});
