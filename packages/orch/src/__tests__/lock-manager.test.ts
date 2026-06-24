import { test, expect, describe, beforeEach } from "bun:test";
import { LockManager } from "../lock/lock-manager.ts";

describe("LockManager", () => {
  let manager: LockManager;

  beforeEach(() => {
    manager = new LockManager();
  });

  test("acquire returns true for a fresh agent", () => {
    expect(manager.acquire("agent-1", "task-1")).toBe(true);
  });

  test("acquire adds taskId to the agent's lock set", () => {
    manager.acquire("agent-1", "task-1");
    const locks = manager.getActiveLocks();
    expect(locks.get("agent-1")).toContain("task-1");
  });

  test("release removes the taskId from the agent's set", () => {
    manager.acquire("agent-1", "task-1");
    manager.release("agent-1", "task-1");
    const locks = manager.getActiveLocks();
    expect(locks.has("agent-1")).toBe(false);
  });

  test("release is a no-op for non-existent lock", () => {
    expect(() => manager.release("agent-1", "task-1")).not.toThrow();
  });

  test("release cleans up empty agent entry", () => {
    manager.acquire("agent-1", "task-1");
    manager.acquire("agent-1", "task-2");
    manager.release("agent-1", "task-1");
    const locks = manager.getActiveLocks();
    expect(locks.get("agent-1")?.size).toBe(1);
    manager.release("agent-1", "task-2");
    expect(locks.has("agent-1")).toBe(false);
  });

  test("isAtCapacity returns false when below maxConcurrent", () => {
    manager.acquire("agent-1", "task-1");
    expect(manager.isAtCapacity("agent-1", 2)).toBe(false);
  });

  test("isAtCapacity returns true when at maxConcurrent", () => {
    manager.acquire("agent-1", "task-1");
    manager.acquire("agent-1", "task-2");
    expect(manager.isAtCapacity("agent-1", 2)).toBe(true);
  });

  test("isAtCapacity returns false for unknown agent", () => {
    expect(manager.isAtCapacity("unknown", 1)).toBe(false);
  });

  test("acquire does not duplicate taskId if called twice", () => {
    manager.acquire("agent-1", "task-1");
    manager.acquire("agent-1", "task-1");
    const locks = manager.getActiveLocks();
    expect(locks.get("agent-1")?.size).toBe(1);
  });

  test("getActiveLocks returns empty map initially", () => {
    const locks = manager.getActiveLocks();
    expect(locks.size).toBe(0);
  });

  test("getActiveLocks reflects all active locks", () => {
    manager.acquire("agent-1", "task-1");
    manager.acquire("agent-2", "task-2");
    const locks = manager.getActiveLocks();
    expect(locks.size).toBe(2);
    expect(locks.get("agent-1")?.has("task-1")).toBe(true);
    expect(locks.get("agent-2")?.has("task-2")).toBe(true);
  });

  test("multiple agents can hold locks simultaneously", () => {
    manager.acquire("agent-1", "task-1");
    manager.acquire("agent-2", "task-2");
    manager.acquire("agent-3", "task-3");
    expect(manager.isAtCapacity("agent-1", 1)).toBe(true);
    expect(manager.isAtCapacity("agent-2", 1)).toBe(true);
    expect(manager.isAtCapacity("agent-3", 1)).toBe(true);
  });
});
