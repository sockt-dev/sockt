import { test, expect, describe, afterEach } from "bun:test";
import { isReadOnlyExec } from "../hitl/readonly-allowlist.ts";

describe("isReadOnlyExec", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("allows a single read-only command", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "kubectl get pods" })).toBe(true);
  });

  test("allows read-only commands piped together", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "kubectl logs my-pod | grep ERROR" })).toBe(true);
  });

  test("allows multiple read-only lines", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "git status\ngit log\nls -la" })).toBe(true);
  });

  test("rejects a redirect even to an otherwise-allowed command", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "echo hi > /etc/passwd" })).toBe(false);
  });

  test("rejects a mutation token even inside a pipe chain", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "cat file.txt | tee /tmp/copy" })).toBe(false);
  });

  test("rejects an unrecognized command", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "some-random-binary --flag" })).toBe(false);
  });

  test("rejects rm/mv/chmod outright", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "rm -rf /tmp/foo" })).toBe(false);
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "chmod 777 /etc/shadow" })).toBe(false);
  });

  test("rejects non-exec_code tools regardless of args", () => {
    expect(isReadOnlyExec("http_request", { language: "bash", code: "git log" })).toBe(false);
  });

  test("rejects non-shell languages", () => {
    expect(isReadOnlyExec("exec_code", { language: "python", code: "print('hello')" })).toBe(false);
  });

  test("rejects empty code", () => {
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "" })).toBe(false);
  });

  test("HITL_READONLY_BYPASS=false disables the bypass entirely", () => {
    process.env.HITL_READONLY_BYPASS = "false";
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "git status" })).toBe(false);
  });

  test("ENGOPS_READONLY_EXTRA adds custom allowed patterns", () => {
    process.env.ENGOPS_READONLY_EXTRA = "^custom-readonly-tool\\b";
    expect(isReadOnlyExec("exec_code", { language: "bash", code: "custom-readonly-tool --check" })).toBe(true);
  });
});
