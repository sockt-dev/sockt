import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { createTestDb } from "../util/test-db.ts";
import { initializeSchema } from "../store/schema.ts";
import { TaskStoreError } from "@sockt/types";
import { Database } from "bun:sqlite";

let store: SqliteTaskStore;

beforeEach(() => {
  const db = createTestDb();
  store = new SqliteTaskStore(db);
});

describe("SqliteTaskStore", () => {
  describe("create", () => {
    test("creates task with defaults", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test task",
      });

      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(task.tenantId).toBe("t1");
      expect(task.status).toBe("pending");
      expect(task.owner).toBeNull();
      expect(task.parentId).toBeNull();
      expect(task.description).toBe("Test task");
      expect(task.output).toBeNull();
      expect(task.llmCallsUsed).toBe(0);
      expect(task.llmCallsBudget).toBe(25);
      expect(task.attemptCount).toBe(0);
      expect(task.maxAttempts).toBe(3);
      expect(task.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(task.updatedAt).toBe(task.createdAt);
    });

    test("creates task with custom budget and attempts", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Custom",
        llmCallsBudget: 100,
        maxAttempts: 5,
      });

      expect(task.llmCallsBudget).toBe(100);
      expect(task.maxAttempts).toBe(5);
    });

    test("creates task with parentId", async () => {
      const parent = await store.create({
        tenantId: "t1",
        description: "Parent",
      });
      const child = await store.create({
        tenantId: "t1",
        description: "Child",
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });
  });

  describe("get", () => {
    test("retrieves created task", async () => {
      const created = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const fetched = await store.get(created.id);

      expect(fetched).toEqual(created);
    });

    test("returns null for non-existent id", async () => {
      const result = await store.get("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    test("applies partial patch", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const updated = await store.update(task.id, { status: "in_progress" });

      expect(updated.status).toBe("in_progress");
      expect(updated.description).toBe("Test");
    });

    test("updates owner", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const updated = await store.update(task.id, { owner: "agent-1" });

      expect(updated.owner).toBe("agent-1");
    });

    test("updates output", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const updated = await store.update(task.id, {
        output: "result data",
      });

      expect(updated.output).toBe("result data");
    });

    test("advances updatedAt", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await store.update(task.id, { status: "in_progress" });

      expect(updated.updatedAt).not.toBe(task.updatedAt);
    });

    test("throws for non-existent task", async () => {
      expect(store.update("non-existent", { status: "completed" })).rejects.toThrow(
        TaskStoreError
      );
    });

    test("handles empty patch without error", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const updated = await store.update(task.id, {});

      expect(updated.id).toBe(task.id);
    });
  });

  describe("claim", () => {
    test("claims pending task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const claimed = await store.claim(task.id, "agent-1");

      expect(claimed.status).toBe("in_progress");
      expect(claimed.owner).toBe("agent-1");
    });

    test("throws when claiming already-claimed task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await store.claim(task.id, "agent-1");

      expect(store.claim(task.id, "agent-2")).rejects.toThrow(TaskStoreError);
    });
  });

  describe("listPending", () => {
    test("returns only pending tasks for tenant", async () => {
      await store.create({ tenantId: "t1", description: "A" });
      await store.create({ tenantId: "t1", description: "B" });
      const t2 = await store.create({ tenantId: "t2", description: "C" });
      await store.claim(t2.id, "agent");

      const pending = await store.listPending("t1");
      expect(pending).toHaveLength(2);
      expect(pending.every((t) => t.tenantId === "t1")).toBe(true);
    });
  });

  describe("listByParent", () => {
    test("returns child tasks", async () => {
      const parent = await store.create({
        tenantId: "t1",
        description: "Parent",
      });
      await store.create({
        tenantId: "t1",
        description: "Child 1",
        parentId: parent.id,
      });
      await store.create({
        tenantId: "t1",
        description: "Child 2",
        parentId: parent.id,
      });

      const children = await store.listByParent(parent.id);
      expect(children).toHaveLength(2);
    });
  });

  describe("listByOwner", () => {
    test("returns tasks owned by agent", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await store.claim(task.id, "agent-1");

      const owned = await store.listByOwner("agent-1");
      expect(owned).toHaveLength(1);
      expect(owned[0]!.owner).toBe("agent-1");
    });
  });

  describe("incrementLlmCalls", () => {
    test("increments and returns remaining", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
        llmCallsBudget: 10,
      });

      const result = await store.incrementLlmCalls(task.id);
      expect(result.remaining).toBe(9);

      const result2 = await store.incrementLlmCalls(task.id);
      expect(result2.remaining).toBe(8);
    });

    test("throws for non-existent task", async () => {
      expect(store.incrementLlmCalls("non-existent")).rejects.toThrow(
        TaskStoreError
      );
    });
  });

  describe("delete", () => {
    test("removes task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await store.delete(task.id);

      const result = await store.get(task.id);
      expect(result).toBeNull();
    });

    test("throws for non-existent task", async () => {
      expect(store.delete("non-existent")).rejects.toThrow(TaskStoreError);
    });
  });

  describe("countByStatus", () => {
    test("returns counts with zeros", async () => {
      await store.create({ tenantId: "t1", description: "A" });
      await store.create({ tenantId: "t1", description: "B" });
      const task3 = await store.create({
        tenantId: "t1",
        description: "C",
      });
      await store.claim(task3.id, "agent-1");

      const counts = await store.countByStatus("t1");
      expect(counts.pending).toBe(2);
      expect(counts.in_progress).toBe(1);
      expect(counts.completed).toBe(0);
      expect(counts.escalated).toBe(0);
      expect(counts.blocked).toBe(0);
      expect(counts.cancelled).toBe(0);
    });
  });

  describe("schema idempotency", () => {
    test("calling initializeSchema twice does not error", () => {
      const db = new Database(":memory:");
      db.exec("PRAGMA journal_mode=WAL");
      initializeSchema(db);
      initializeSchema(db);
    });
  });

  describe("WAL mode", () => {
    test("WAL mode is set on file-backed database", () => {
      const path = `/tmp/sockt-test-${Date.now()}.db`;
      const db = new Database(path);
      db.exec("PRAGMA journal_mode=WAL");
      initializeSchema(db);
      const result = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      expect(result.journal_mode).toBe("wal");
      db.close();
      require("fs").unlinkSync(path);
    });
  });
});
