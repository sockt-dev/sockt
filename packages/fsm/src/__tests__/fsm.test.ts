import { test, expect, describe, beforeEach } from "bun:test";
import { FsmEngine } from "../fsm/engine.ts";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { createTestDb } from "../util/test-db.ts";
import { TRANSITIONS, canTransition } from "../fsm/transitions.ts";
import { TaskStoreError, TASK_STATUS_VALUES } from "@sockt/types";
import type { TaskStatus } from "@sockt/types";

let store: SqliteTaskStore;
let engine: FsmEngine;

beforeEach(() => {
  const db = createTestDb();
  store = new SqliteTaskStore(db);
  engine = new FsmEngine(store);
});

describe("FsmEngine", () => {
  describe("canTransition", () => {
    test("pending can go to in_progress", () => {
      expect(engine.canTransition("pending", "in_progress")).toBe(true);
    });

    test("pending can go to cancelled", () => {
      expect(engine.canTransition("pending", "cancelled")).toBe(true);
    });

    test("pending cannot go to completed", () => {
      expect(engine.canTransition("pending", "completed")).toBe(false);
    });

    test("in_progress can go to completed", () => {
      expect(engine.canTransition("in_progress", "completed")).toBe(true);
    });

    test("in_progress can go to escalated", () => {
      expect(engine.canTransition("in_progress", "escalated")).toBe(true);
    });

    test("in_progress can go to blocked", () => {
      expect(engine.canTransition("in_progress", "blocked")).toBe(true);
    });

    test("completed is terminal", () => {
      for (const status of TASK_STATUS_VALUES) {
        expect(engine.canTransition("completed", status)).toBe(false);
      }
    });

    test("cancelled is terminal", () => {
      for (const status of TASK_STATUS_VALUES) {
        expect(engine.canTransition("cancelled", status)).toBe(false);
      }
    });

    test("escalated can go to pending", () => {
      expect(engine.canTransition("escalated", "pending")).toBe(true);
    });

    test("blocked can go to pending", () => {
      expect(engine.canTransition("blocked", "pending")).toBe(true);
    });
  });

  describe("transition", () => {
    test("valid transition updates task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const updated = await engine.transition(
        task.id,
        "pending",
        "in_progress",
        "agent-1"
      );

      expect(updated.status).toBe("in_progress");
    });

    test("invalid transition throws TaskStoreError", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });

      expect(
        engine.transition(task.id, "pending", "completed", "agent-1")
      ).rejects.toThrow(TaskStoreError);
    });

    test("status mismatch throws TaskStoreError", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });

      expect(
        engine.transition(task.id, "in_progress", "completed", "agent-1")
      ).rejects.toThrow(TaskStoreError);
    });

    test("non-existent task throws TaskStoreError", async () => {
      expect(
        engine.transition("non-existent", "pending", "in_progress", "agent-1")
      ).rejects.toThrow(TaskStoreError);
    });

    test("all valid transitions in the table succeed", async () => {
      for (const [from, targets] of Object.entries(TRANSITIONS)) {
        for (const to of targets) {
          const task = await store.create({
            tenantId: "t1",
            description: `${from} -> ${to}`,
          });

          if (from !== "pending") {
            await store.update(task.id, { status: from as TaskStatus });
          }

          const result = await engine.transition(
            task.id,
            from as TaskStatus,
            to as TaskStatus,
            "agent"
          );
          expect(result.status).toBe(to);
        }
      }
    });
  });

  describe("validateCreation", () => {
    test("worker cannot create top-level task", () => {
      const result = engine.validateCreation(null, "worker");
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test("worker can create subtask", () => {
      const result = engine.validateCreation("parent-id", "worker");
      expect(result.valid).toBe(true);
    });

    test("architect can create top-level task", () => {
      const result = engine.validateCreation(null, "architect");
      expect(result.valid).toBe(true);
    });

    test("architect can create subtask", () => {
      const result = engine.validateCreation("parent-id", "architect");
      expect(result.valid).toBe(true);
    });
  });
});

describe("canTransition (standalone)", () => {
  test("matches TRANSITIONS table", () => {
    for (const from of TASK_STATUS_VALUES) {
      for (const to of TASK_STATUS_VALUES) {
        const expected = TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });
});
