import { test, expect, describe, beforeEach } from "bun:test";
import { FsmEngine } from "../fsm/engine.ts";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { createTestDb } from "../util/test-db.ts";
import { TaskStoreError } from "@sockt/types";

let store: SqliteTaskStore;
let engine: FsmEngine;

beforeEach(() => {
  const db = createTestDb();
  store = new SqliteTaskStore(db);
  engine = new FsmEngine(store);
});

describe("Budget enforcement", () => {
  test("allowed when remaining > 0", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 10,
    });
    await store.update(task.id, { status: "in_progress" });

    const result = await engine.checkBudget(task.id);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
    expect(result.autoEscalated).toBe(false);
  });

  test("auto-escalates when budget exhausted on in_progress task", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 2,
    });
    await store.update(task.id, { status: "in_progress" });
    await store.incrementLlmCalls(task.id);
    await store.incrementLlmCalls(task.id);

    const result = await engine.checkBudget(task.id);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.autoEscalated).toBe(true);

    const updated = await store.get(task.id);
    expect(updated!.status).toBe("escalated");
  });

  test("does not auto-escalate already escalated task", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 1,
    });
    await store.update(task.id, { status: "in_progress" });
    await store.incrementLlmCalls(task.id);

    await engine.checkBudget(task.id);

    const result = await engine.checkBudget(task.id);
    expect(result.allowed).toBe(false);
    expect(result.autoEscalated).toBe(false);
  });

  test("incrementLlmCalls tracks remaining correctly", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 5,
    });

    for (let i = 4; i >= 0; i--) {
      const result = await store.incrementLlmCalls(task.id);
      expect(result.remaining).toBe(i);
    }
  });

  test("throws for non-existent task", async () => {
    expect(engine.checkBudget("non-existent")).rejects.toThrow(TaskStoreError);
  });

  test("budget check on pending task with exhausted budget does not escalate", async () => {
    const task = await store.create({
      tenantId: "t1",
      description: "Test",
      llmCallsBudget: 1,
    });
    await store.incrementLlmCalls(task.id);

    const result = await engine.checkBudget(task.id);
    expect(result.allowed).toBe(false);
    expect(result.autoEscalated).toBe(false);

    const fetched = await store.get(task.id);
    expect(fetched!.status).toBe("pending");
  });
});
