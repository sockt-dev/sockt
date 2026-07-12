import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { makeCreateTaskHandler } from "../tools/built-in/create_task.ts";

// Regression coverage for two bugs found in the 2026-07-11 post-fix verification
// pass: (1) the model sometimes calls create_task with an empty/placeholder
// description, creating an orphaned unactionable subtask; (2) re-planning
// across Plan/Act/Observe/Reflect cycles has no memory of prior create_task
// calls (plan.ts trims context to the system prompt only), so the same
// deliverable gets delegated repeatedly — one G3 rerun produced 12 children
// for a ~4-deliverable request.

describe("create_task tool handler", () => {
  let server: ReturnType<typeof Bun.serve>;
  let orchUrl: string;
  let nextId = 0;
  let lastBody: any;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "POST" && new URL(req.url).pathname === "/tasks") {
          nextId++;
          lastBody = await req.json().catch(() => null);
          return Response.json({ id: `task-${nextId}`, status: "pending" });
        }
        return new Response("not found", { status: 404 });
      },
    });
    orchUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("rejects an empty description instead of creating an orphaned task", async () => {
    const currentTaskId = { value: "parent-1" };
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

    await expect(handler({ description: "" })).rejects.toThrow(/non-empty/);
    await expect(handler({ description: "   " })).rejects.toThrow(/non-empty/);
  });

  test("a second create_task call with the same description under the same parent is skipped, not duplicated", async () => {
    const currentTaskId = { value: "parent-2" };
    const createdByParent = new Map<string, Set<string>>();
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, createdByParent, new Map());

    const first = await handler({ description: "Generate a lead list for the new pricing tier" }) as { taskId: string; status: string };
    expect(first.status).toBe("pending");
    expect(first.taskId).toBeTruthy();

    const second = await handler({ description: "generate a lead list for the new pricing tier  " }) as { taskId: string | null; status: string };
    expect(second.status).toBe("skipped-duplicate");
    expect(second.taskId).toBeNull();
  });

  test("different descriptions under the same parent both get created", async () => {
    const currentTaskId = { value: "parent-3" };
    const createdByParent = new Map<string, Set<string>>();
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, createdByParent, new Map());

    const a = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    const b = await handler({ description: "Write the outreach copy" }) as { taskId: string; status: string };
    expect(a.status).toBe("pending");
    expect(b.status).toBe("pending");
    expect(a.taskId).not.toBe(b.taskId);
  });

  test("the same description under a different parent is not treated as a duplicate", async () => {
    const currentTaskId = { value: "parent-4a" };
    const createdByParent = new Map<string, Set<string>>();
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, createdByParent, new Map());

    const first = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    expect(first.status).toBe("pending");

    currentTaskId.value = "parent-4b";
    const second = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    expect(second.status).toBe("pending");
  });

  describe("department targeting", () => {
    test("defaults to the caller's own department when none is given", async () => {
      const currentTaskId = { value: "parent-5" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      const result = await handler({ description: "Generate a lead list" }) as { targetDepartment: string };
      expect(result.targetDepartment).toBe("growth");
      expect(lastBody.targetDepartment).toBe("growth");
      expect(lastBody.targetRole).toBe("worker");
    });

    test("honors an explicit department override for cross-department delegation", async () => {
      const currentTaskId = { value: "parent-6" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      const result = await handler({ description: "File a bug for broken tracking pixel", department: "engops" }) as { targetDepartment: string };
      expect(result.targetDepartment).toBe("engops");
      expect(lastBody.targetDepartment).toBe("engops");
    });

    test("rejects an unrecognized department instead of silently creating an untagged task", async () => {
      const currentTaskId = { value: "parent-7" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      await expect(handler({ description: "Do something", department: "marketing" })).rejects.toThrow(/growth, product, engops, general/);
    });
  });

  describe("skill targeting", () => {
    test("passes the skill through to the created task", async () => {
      const currentTaskId = { value: "parent-8" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      const result = await handler({ description: "Generate a lead list", skill: "lead-generation" }) as { targetSkill: string };
      expect(result.targetSkill).toBe("lead-generation");
      expect(lastBody.targetSkill).toBe("lead-generation");
    });

    test("omits targetSkill when no skill is given", async () => {
      const currentTaskId = { value: "parent-9" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      await handler({ description: "Do a thing" });
      expect(lastBody.targetSkill).toBeUndefined();
    });
  });

  describe("after (ordering) validation", () => {
    test("accepts an after id this execution actually created", async () => {
      const currentTaskId = { value: "parent-10" };
      const createdIdsByParent = new Map<string, Set<string>>();
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), createdIdsByParent);

      const first = await handler({ description: "Generate a lead list" }) as { taskId: string };
      const second = await handler({ description: "Write outreach copy", after: first.taskId }) as { afterId: string };

      expect(second.afterId).toBe(first.taskId);
      expect(lastBody.afterId).toBe(first.taskId);
    });

    test("rejects an after id this execution did not create", async () => {
      const currentTaskId = { value: "parent-11" };
      const handler = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", currentTaskId, new Map(), new Map());

      await expect(handler({ description: "Write outreach copy", after: "some-other-task-id" }))
        .rejects.toThrow(/after.*must be a taskId YOU created/);
    });

    test("rejects an after id created under a different parent", async () => {
      const createdIdsByParent = new Map<string, Set<string>>();
      const handlerA = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", { value: "parent-12a" }, new Map(), createdIdsByParent);
      const first = await handlerA({ description: "Generate a lead list" }) as { taskId: string };

      const handlerB = makeCreateTaskHandler(orchUrl, "tenant-1", "growth", { value: "parent-12b" }, new Map(), createdIdsByParent);
      await expect(handlerB({ description: "Write outreach copy", after: first.taskId }))
        .rejects.toThrow(/after.*must be a taskId YOU created/);
    });
  });
});
