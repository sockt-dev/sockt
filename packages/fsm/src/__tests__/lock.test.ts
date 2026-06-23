import { test, expect, describe, beforeEach } from "bun:test";
import { TaskClaimLock } from "../lock/task-claim-lock.ts";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { createTestDb } from "../util/test-db.ts";
import { TaskStoreError } from "@sockt/types";
import type { Database } from "bun:sqlite";

let db: Database;
let store: SqliteTaskStore;
let lock: TaskClaimLock;

beforeEach(() => {
  db = createTestDb();
  store = new SqliteTaskStore(db);
  lock = new TaskClaimLock(db);
});

describe("TaskClaimLock", () => {
  describe("attemptClaim", () => {
    test("successfully claims a pending task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      const claimed = await lock.attemptClaim(task.id, "agent-1");

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("in_progress");
      expect(claimed!.owner).toBe("agent-1");
    });

    test("returns null for already-claimed task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await lock.attemptClaim(task.id, "agent-1");
      const second = await lock.attemptClaim(task.id, "agent-2");

      expect(second).toBeNull();
    });

    test("returns null for non-pending task", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await store.update(task.id, { status: "cancelled" });
      const result = await lock.attemptClaim(task.id, "agent-1");

      expect(result).toBeNull();
    });

    test("returns null for non-existent task", async () => {
      const result = await lock.attemptClaim("non-existent", "agent-1");
      expect(result).toBeNull();
    });

    test("only one agent wins a claim race", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Race",
      });
      const results = await Promise.all([
        lock.attemptClaim(task.id, "agent-a"),
        lock.attemptClaim(task.id, "agent-b"),
      ]);
      const winners = results.filter(Boolean);
      expect(winners).toHaveLength(1);
    });
  });

  describe("releaseClaim", () => {
    test("releases claim and returns to pending", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await lock.attemptClaim(task.id, "agent-1");
      const released = await lock.releaseClaim(task.id, "agent-1");

      expect(released.status).toBe("pending");
      expect(released.owner).toBeNull();
    });

    test("throws if not the owner", async () => {
      const task = await store.create({
        tenantId: "t1",
        description: "Test",
      });
      await lock.attemptClaim(task.id, "agent-1");

      expect(lock.releaseClaim(task.id, "agent-2")).rejects.toThrow(
        TaskStoreError
      );
    });

    test("throws for non-existent task", async () => {
      expect(
        lock.releaseClaim("non-existent", "agent-1")
      ).rejects.toThrow(TaskStoreError);
    });
  });
});
