import { test, expect, describe, beforeEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import type { Database } from "bun:sqlite";
import { TaskOriginStore } from "../store/task-origin-store.ts";

describe("TaskOriginStore", () => {
  let db: Database;
  let store: TaskOriginStore;

  beforeEach(() => {
    db = createTestDb();
    store = new TaskOriginStore(db);
  });

  test("create then get round-trips the origin", () => {
    store.create({ taskId: "task-1", tenantId: "t1", platform: "slack", channelId: "C1", threadId: "1000.1" });
    const origin = store.get("task-1");

    expect(origin).not.toBeNull();
    expect(origin!.taskId).toBe("task-1");
    expect(origin!.channelId).toBe("C1");
    expect(origin!.threadId).toBe("1000.1");
  });

  test("get returns null for an unknown task", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  test("threadId can be null (e.g. a top-level message with no thread yet)", () => {
    store.create({ taskId: "task-2", tenantId: "t1", platform: "slack", channelId: "C1", threadId: null });
    const origin = store.get("task-2");
    expect(origin!.threadId).toBeNull();
  });

  test("findByThread locates the task that owns a given thread", () => {
    store.create({ taskId: "task-3", tenantId: "t1", platform: "slack", channelId: "C1", threadId: "3000.1" });
    const found = store.findByThread("t1", "C1", "3000.1");
    expect(found?.taskId).toBe("task-3");
  });

  test("findByThread is scoped by tenant — same channel/thread in a different tenant doesn't match", () => {
    store.create({ taskId: "task-4", tenantId: "tenant-a", platform: "slack", channelId: "C1", threadId: "4000.1" });
    expect(store.findByThread("tenant-b", "C1", "4000.1")).toBeNull();
  });

  test("a second create() for the same taskId does not overwrite the first (ON CONFLICT DO NOTHING)", () => {
    store.create({ taskId: "task-5", tenantId: "t1", platform: "slack", channelId: "C1", threadId: "5000.1" });
    store.create({ taskId: "task-5", tenantId: "t1", platform: "slack", channelId: "C-different", threadId: "9999.1" });

    const origin = store.get("task-5");
    expect(origin!.channelId).toBe("C1");
  });
});
