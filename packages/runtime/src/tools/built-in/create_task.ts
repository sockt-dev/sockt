import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

export const createTaskDefinition: ToolDefinition = {
  name: "create_task",
  description: "Create a subtask in the orchestrator. Use this to delegate work to other agents or queue follow-up work.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the subtask should accomplish — must be specific and non-empty, e.g. \"Generate a scored lead list of 10 B2B SaaS companies in the Nordics\", not a placeholder." },
      budget: { type: "number", description: "Max LLM calls for the subtask (default 10)" },
    },
    required: ["description"],
  },
};

function normalize(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

// currentTaskId is a mutable ref, not a plain value: the ToolRegistry (and the
// handlers registered into it) is created once per worker process and shared
// across every task that process ever executes, so the parent task id can't
// be captured as a constant at registration time — it has to be read fresh on
// each call. The caller (serve.ts) updates .value before each executeTask().
//
// createdByParent tracks descriptions already delegated under the current
// parent task, keyed by currentTaskId.value. Needed because the plan phase
// re-plans from just the system prompt on each Plan/Act/Observe/Reflect cycle
// (see runner/plan.ts's context trimming) — the model has no memory of its
// own prior create_task calls across cycles, so without this it re-delegates
// the same deliverables repeatedly (observed: 12 children for one ~4-deliverable
// request in the 2026-07-11 post-fix verification pass). The caller resets
// the parent's entry when a new top-level task starts claiming.
export const makeCreateTaskHandler = (
  orchUrl: string,
  tenantId: string,
  currentTaskId: { value?: string },
  createdByParent: Map<string, Set<string>>,
): ToolHandler =>
  async (args) => {
    const description = String(args.description ?? "").trim();
    const budget = Number(args.budget ?? 10);

    if (!description) {
      throw new Error(
        "create_task requires a non-empty, specific description of what the subtask should accomplish. Retry with real content, not a placeholder.",
      );
    }

    const parentKey = currentTaskId.value ?? "";
    const seen = createdByParent.get(parentKey) ?? new Set<string>();
    createdByParent.set(parentKey, seen);
    const key = normalize(description);
    if (seen.has(key)) {
      return {
        taskId: null,
        status: "skipped-duplicate",
        description,
        note: "A subtask with this exact description was already created earlier in this execution — not creating a duplicate. Move on to the next distinct deliverable, or finish if everything has been delegated.",
      };
    }

    const res = await fetch(`${orchUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        description,
        llmCallsBudget: budget,
        parentId: currentTaskId.value,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
    const task = await res.json() as { id: string; status: string };
    seen.add(key);
    return { taskId: task.id, status: task.status, description };
  };
