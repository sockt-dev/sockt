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

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "POST" && new URL(req.url).pathname === "/tasks") {
          nextId++;
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
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", currentTaskId, new Map());

    await expect(handler({ description: "" })).rejects.toThrow(/non-empty/);
    await expect(handler({ description: "   " })).rejects.toThrow(/non-empty/);
  });

  test("a second create_task call with the same description under the same parent is skipped, not duplicated", async () => {
    const currentTaskId = { value: "parent-2" };
    const createdByParent = new Map<string, Set<string>>();
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", currentTaskId, createdByParent);

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
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", currentTaskId, createdByParent);

    const a = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    const b = await handler({ description: "Write the outreach copy" }) as { taskId: string; status: string };
    expect(a.status).toBe("pending");
    expect(b.status).toBe("pending");
    expect(a.taskId).not.toBe(b.taskId);
  });

  test("the same description under a different parent is not treated as a duplicate", async () => {
    const currentTaskId = { value: "parent-4a" };
    const createdByParent = new Map<string, Set<string>>();
    const handler = makeCreateTaskHandler(orchUrl, "tenant-1", currentTaskId, createdByParent);

    const first = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    expect(first.status).toBe("pending");

    currentTaskId.value = "parent-4b";
    const second = await handler({ description: "Generate a lead list" }) as { taskId: string; status: string };
    expect(second.status).toBe("pending");
  });
});
