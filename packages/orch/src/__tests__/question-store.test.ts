import { test, expect, describe, beforeEach } from "bun:test";
import { createTestDb } from "@sockt/fsm";
import type { Database } from "bun:sqlite";
import { QuestionStore } from "../api/question-store.ts";

describe("QuestionStore", () => {
  let db: Database;
  let store: QuestionStore;

  beforeEach(() => {
    db = createTestDb();
    store = new QuestionStore(db);
  });

  test("create then get round-trips the question as pending", () => {
    const question = store.create({
      tenantId: "t1",
      taskId: "task-1",
      agentId: "agent-1",
      question: "Which environment should I deploy to?",
      slackChannelId: "C1",
      slackThreadId: "1000.1",
    });

    const fetched = store.get(question.id);
    expect(fetched?.status).toBe("pending");
    expect(fetched?.question).toBe("Which environment should I deploy to?");
  });

  test("findPendingByThread locates a pending question by tenant/channel/thread", () => {
    store.create({
      tenantId: "t1",
      taskId: "task-2",
      agentId: "agent-1",
      question: "Prod or staging?",
      slackChannelId: "C1",
      slackThreadId: "2000.1",
    });

    const found = store.findPendingByThread("t1", "C1", "2000.1");
    expect(found?.taskId).toBe("task-2");
  });

  test("findPendingByThread does not match a different tenant", () => {
    store.create({
      tenantId: "tenant-a",
      taskId: "task-3",
      agentId: "agent-1",
      question: "Which one?",
      slackChannelId: "C1",
      slackThreadId: "3000.1",
    });

    expect(store.findPendingByThread("tenant-b", "C1", "3000.1")).toBeUndefined();
  });

  test("answer marks the question answered and findPendingByThread no longer matches it", () => {
    const question = store.create({
      tenantId: "t1",
      taskId: "task-4",
      agentId: "agent-1",
      question: "Which one?",
      slackChannelId: "C1",
      slackThreadId: "4000.1",
    });

    const answered = store.answer(question.id, "staging");
    expect(answered?.status).toBe("answered");
    expect(answered?.answer).toBe("staging");
    expect(store.findPendingByThread("t1", "C1", "4000.1")).toBeUndefined();
  });

  test("answering an already-answered question is a no-op that returns current state", () => {
    const question = store.create({
      tenantId: "t1",
      taskId: "task-5",
      agentId: "agent-1",
      question: "Which one?",
    });
    store.answer(question.id, "first answer");
    const second = store.answer(question.id, "second answer");
    expect(second?.answer).toBe("first answer");
  });
});
