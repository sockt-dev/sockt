import { test, expect, describe, beforeEach } from "bun:test";
import { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import { createTestDb } from "../util/test-db.ts";
import { initializeSchema } from "../store/schema.ts";
import { TaskStoreError } from "@sockt/types";
import { Database } from "bun:sqlite";
import fs from "node:fs";

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

  describe("resumeIfBlocked", () => {
    test("resumes a blocked task to pending, clears owner, and sets the new description", async () => {
      const task = await store.create({ tenantId: "t1", description: "original" });
      await store.claim(task.id, "agent-1");
      await store.update(task.id, { status: "blocked" });

      const resumed = await store.resumeIfBlocked(task.id, "joined description");
      expect(resumed?.status).toBe("pending");
      expect(resumed?.owner).toBeNull();
      expect(resumed?.description).toBe("joined description");
    });

    test("returns null (no-op) when the task is not currently blocked", async () => {
      const task = await store.create({ tenantId: "t1", description: "original" });
      // still pending, never blocked
      const result = await store.resumeIfBlocked(task.id, "should not apply");

      expect(result).toBeNull();
      const unchanged = await store.get(task.id);
      expect(unchanged?.description).toBe("original");
      expect(unchanged?.status).toBe("pending");
    });

    test("a second call after the first already resumed the task is a no-op (atomic race guard)", async () => {
      const task = await store.create({ tenantId: "t1", description: "original" });
      await store.claim(task.id, "agent-1");
      await store.update(task.id, { status: "blocked" });

      const first = await store.resumeIfBlocked(task.id, "first write");
      expect(first?.description).toBe("first write");

      const second = await store.resumeIfBlocked(task.id, "second write — should not apply");
      expect(second).toBeNull();

      const final = await store.get(task.id);
      expect(final?.description).toBe("first write");
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

    test("a task with afterId does not appear until its dependency completes", async () => {
      const dep = await store.create({ tenantId: "t1", description: "Generate leads" });
      await store.create({ tenantId: "t1", description: "Write outreach copy", afterId: dep.id });

      let pending = await store.listPending("t1");
      expect(pending.map((t) => t.description)).toEqual(["Generate leads"]);

      await store.claim(dep.id, "agent-1");
      await store.update(dep.id, { status: "completed", output: "done" });

      // dep itself is no longer 'pending' (it's 'completed') — only the
      // formerly-hidden dependent should now show up.
      pending = await store.listPending("t1");
      expect(pending.map((t) => t.description)).toEqual(["Write outreach copy"]);
    });

    test("a task with afterId stays hidden if its dependency escalates instead of completing", async () => {
      const dep = await store.create({ tenantId: "t1", description: "Generate leads" });
      await store.create({ tenantId: "t1", description: "Write outreach copy", afterId: dep.id });

      await store.claim(dep.id, "agent-1");
      await store.update(dep.id, { status: "escalated", output: "no leads found" });

      const pending = await store.listPending("t1");
      expect(pending.map((t) => t.description)).toEqual([]);
    });

    test("an afterId pointing at a completed task in a DIFFERENT tenant does not unlock the dependent (tenant isolation)", async () => {
      // Regression: the EXISTS subquery originally matched by `d.id` alone,
      // with no tenant_id constraint — a task whose afterId happened to
      // reference another tenant's completed task would incorrectly become
      // claimable, leaking that tenant's task-completion state across the
      // tenant boundary.
      const otherTenantDep = await store.create({ tenantId: "t2", description: "Other tenant's task" });
      await store.claim(otherTenantDep.id, "agent-1");
      await store.update(otherTenantDep.id, { status: "completed", output: "done" });

      await store.create({ tenantId: "t1", description: "Depends on someone else's task", afterId: otherTenantDep.id });

      const pending = await store.listPending("t1");
      expect(pending.map((t) => t.description)).toEqual([]);
    });
  });

  describe("listPendingWithDeadDependency", () => {
    test("finds pending tasks whose dependency escalated or was cancelled", async () => {
      const dep1 = await store.create({ tenantId: "t1", description: "Dep 1" });
      const dep2 = await store.create({ tenantId: "t1", description: "Dep 2" });
      const stuck1 = await store.create({ tenantId: "t1", description: "Stuck on dep1", afterId: dep1.id });
      const stuck2 = await store.create({ tenantId: "t1", description: "Stuck on dep2", afterId: dep2.id });
      await store.create({ tenantId: "t1", description: "No dependency" });

      await store.update(dep1.id, { status: "escalated" });
      await store.update(dep2.id, { status: "cancelled" });

      const dead = await store.listPendingWithDeadDependency();
      const deadIds = dead.map((t) => t.id).sort();
      expect(deadIds).toEqual([stuck1.id, stuck2.id].sort());
    });

    test("does not flag a task whose dependency is still pending or completed", async () => {
      const stillPending = await store.create({ tenantId: "t1", description: "Dep still pending" });
      await store.create({ tenantId: "t1", description: "Waiting on it", afterId: stillPending.id });

      const completed = await store.create({ tenantId: "t1", description: "Dep completed" });
      await store.update(completed.id, { status: "completed" });
      // completed dependency means the dependent is just pending normally, not "dead"
      await store.create({ tenantId: "t1", description: "Ready to go", afterId: completed.id });

      const dead = await store.listPendingWithDeadDependency();
      expect(dead).toEqual([]);
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

      // Windows doesn't release a WAL-mode sqlite file's lock the instant
      // close() returns the way POSIX does — unlinkSync can throw EBUSY on
      // a file that was *just* closed. Cleanup, not the test's assertion
      // (already passed above), so best-effort: retry briefly, then give up
      // silently rather than fail the test over a temp-file leak.

      for (const suffix of ["", "-wal", "-shm"]) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            fs.unlinkSync(path + suffix);
            break;
          } catch (err: any) {
            if (err?.code === "ENOENT") break; // nothing to clean up
            if (attempt === 4) break; // give up quietly, don't fail the test on cleanup
            const waitUntil = Date.now() + 20;
            while (Date.now() < waitUntil) { /* brief synchronous backoff */ }
          }
        }
      }
    });
  });
});
