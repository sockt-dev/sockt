import { test, expect, describe, beforeEach } from "bun:test";
import { LockManager } from "../lock/lock-manager.ts";

describe("LockManager — stress & edge cases", () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = new LockManager();
  });

  test("handles 1000 agents each with 10 tasks", () => {
    for (let a = 0; a < 1000; a++) {
      for (let t = 0; t < 10; t++) {
        manager.acquire(`agent-${a}`, `task-${a}-${t}`);
      }
    }
    expect(manager.getActiveLocks().size).toBe(1000);
    expect(manager.isAtCapacity("agent-500", 10)).toBe(true);
    expect(manager.isAtCapacity("agent-500", 11)).toBe(false);
  });

  test("rapid acquire/release cycles maintain consistency", () => {
    for (let i = 0; i < 10000; i++) {
      manager.acquire("agent-1", `task-${i}`);
      manager.release("agent-1", `task-${i}`);
    }
    expect(manager.getActiveLocks().size).toBe(0);
  });

  test("release all tasks for an agent one by one cleans up", () => {
    const count = 50;
    for (let i = 0; i < count; i++) {
      manager.acquire("agent-x", `task-${i}`);
    }
    expect(manager.isAtCapacity("agent-x", count)).toBe(true);

    for (let i = 0; i < count; i++) {
      manager.release("agent-x", `task-${i}`);
    }
    expect(manager.getActiveLocks().has("agent-x")).toBe(false);
  });

  test("acquire same task across different agents", () => {
    for (let a = 0; a < 100; a++) {
      manager.acquire(`agent-${a}`, "shared-task");
    }
    expect(manager.getActiveLocks().size).toBe(100);
    for (let a = 0; a < 100; a++) {
      expect(manager.getActiveLocks().get(`agent-${a}`)?.has("shared-task")).toBe(true);
    }
  });

  test("release non-existent agent then non-existent task is no-op", () => {
    manager.acquire("agent-1", "task-1");
    manager.release("agent-999", "task-999");
    manager.release("agent-1", "task-999");
    expect(manager.getActiveLocks().get("agent-1")?.has("task-1")).toBe(true);
  });

  test("isAtCapacity with maxConcurrent 0 is always at capacity", () => {
    expect(manager.isAtCapacity("agent-1", 0)).toBe(true);
  });

  test("getActiveLocks returns a reference, mutations reflect", () => {
    manager.acquire("agent-1", "task-1");
    const locks = manager.getActiveLocks();
    manager.acquire("agent-1", "task-2");
    expect(locks.get("agent-1")?.size).toBe(2);
  });

  test("empty string agent and task ids work", () => {
    expect(manager.acquire("", "")).toBe(true);
    expect(manager.getActiveLocks().get("")?.has("")).toBe(true);
    manager.release("", "");
    expect(manager.getActiveLocks().has("")).toBe(false);
  });
});
