import { test, expect, describe } from "bun:test";
import {
  SocktError,
  TaskStoreError,
  MemoryError,
  LlmError,
  SandboxError,
  HitlError,
} from "../index.ts";

describe("SocktError", () => {
  test("extends Error", () => {
    const err = new SocktError("test", "TEST_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
  });

  test("has correct properties", () => {
    const ctx = { taskId: "t1" };
    const err = new SocktError("something failed", "MY_CODE", ctx);
    expect(err.message).toBe("something failed");
    expect(err.code).toBe("MY_CODE");
    expect(err.context).toEqual(ctx);
    expect(err.name).toBe("SocktError");
  });

  test("has a stack trace", () => {
    const err = new SocktError("test", "CODE");
    expect(err.stack).toBeDefined();
  });
});

describe("TaskStoreError", () => {
  test("instanceof chain", () => {
    const err = new TaskStoreError("not found");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
    expect(err).toBeInstanceOf(TaskStoreError);
  });

  test("has correct code and name", () => {
    const err = new TaskStoreError("not found", { id: "task-1" });
    expect(err.code).toBe("TASK_STORE_ERROR");
    expect(err.name).toBe("TaskStoreError");
    expect(err.context).toEqual({ id: "task-1" });
  });
});

describe("MemoryError", () => {
  test("instanceof chain", () => {
    const err = new MemoryError("write failed");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
    expect(err).toBeInstanceOf(MemoryError);
  });

  test("has correct code and name", () => {
    const err = new MemoryError("write failed");
    expect(err.code).toBe("MEMORY_ERROR");
    expect(err.name).toBe("MemoryError");
  });
});

describe("LlmError", () => {
  test("instanceof chain", () => {
    const err = new LlmError("rate limited");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
    expect(err).toBeInstanceOf(LlmError);
  });

  test("has correct code and name", () => {
    const err = new LlmError("rate limited");
    expect(err.code).toBe("LLM_ERROR");
    expect(err.name).toBe("LlmError");
  });
});

describe("SandboxError", () => {
  test("instanceof chain", () => {
    const err = new SandboxError("container failed");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
    expect(err).toBeInstanceOf(SandboxError);
  });

  test("has correct code and name", () => {
    const err = new SandboxError("container failed");
    expect(err.code).toBe("SANDBOX_ERROR");
    expect(err.name).toBe("SandboxError");
  });
});

describe("HitlError", () => {
  test("instanceof chain", () => {
    const err = new HitlError("timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SocktError);
    expect(err).toBeInstanceOf(HitlError);
  });

  test("has correct code and name", () => {
    const err = new HitlError("timeout");
    expect(err.code).toBe("HITL_ERROR");
    expect(err.name).toBe("HitlError");
  });
});
