import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

const VALID_DEPARTMENTS = new Set(["growth", "product", "engops", "general"]);

export const createTaskDefinition: ToolDefinition = {
  name: "create_task",
  description: "Create a subtask in the orchestrator. Use this to delegate work to other agents or queue follow-up work.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the subtask should accomplish — must be specific and non-empty, e.g. \"Generate a scored lead list of 10 B2B SaaS companies in the Nordics\", not a placeholder." },
      budget: { type: "number", description: "Max LLM calls for the subtask (default 10)" },
      department: { type: "string", description: "Target department: growth | product | engops. Defaults to your own department — only set this to delegate cross-department." },
      skill: { type: "string", description: "Exact worker skill this subtask needs (e.g. lead-generation, spec-writing, runbook-writer) — the worker will be told to use it specifically." },
      after: { type: "string", description: "taskId of a subtask YOU created earlier in this same execution that must COMPLETE before this one starts. Use to order dependent work (e.g. email-sequence after lead-generation)." },
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
//
// createdIdsByParent is the same idea, but tracks the taskIds this execution
// actually created (not their descriptions) — so a later create_task's
// "after" reference can be validated against a real subtask this run
// produced, rather than an arbitrary/hallucinated id. Same ownership/reset
// lifecycle as createdByParent; the caller (serve.ts) owns and clears both.
export const makeCreateTaskHandler = (
  orchUrl: string,
  tenantId: string,
  ownDepartment: string,
  currentTaskId: { value?: string },
  createdByParent: Map<string, Set<string>>,
  createdIdsByParent: Map<string, Set<string>>,
  apiToken?: string,
): ToolHandler =>
  async (args) => {
    const description = String(args.description ?? "").trim();
    const budget = Number(args.budget ?? 10);

    if (!description) {
      throw new Error(
        "create_task requires a non-empty, specific description of what the subtask should accomplish. Retry with real content, not a placeholder.",
      );
    }

    // Untagged subtasks default to the CALLER's own department, not "no
    // department" — an untargeted subtask used to be claimable by any worker
    // in any department, which is exactly how a growth subtask ended up
    // executed by an engops worker running the engops system prompt (no
    // Rollback mandate, no growth skills). See docs/ARCHITECTURE.md.
    const targetDepartment = args.department ? String(args.department) : ownDepartment;
    if (!VALID_DEPARTMENTS.has(targetDepartment)) {
      throw new Error(
        `create_task department must be one of growth, product, engops, general — got "${targetDepartment}". Omit it to delegate within your own department.`,
      );
    }
    const targetSkill = args.skill ? String(args.skill) : undefined;

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

    let afterId: string | undefined;
    if (args.after) {
      afterId = String(args.after);
      const createdIds = createdIdsByParent.get(parentKey);
      if (!createdIds?.has(afterId)) {
        throw new Error(
          `create_task's "after" must be a taskId YOU created earlier in this execution (via an earlier create_task call), not "${afterId}". Omit it if this subtask has no ordering dependency.`,
        );
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

    const res = await fetch(`${orchUrl}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenantId,
        description,
        llmCallsBudget: budget,
        parentId: currentTaskId.value,
        targetDepartment,
        targetRole: "worker",
        targetSkill,
        afterId,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
    const task = await res.json() as { id: string; status: string };
    seen.add(key);

    const createdIds = createdIdsByParent.get(parentKey) ?? new Set<string>();
    createdIds.add(task.id);
    createdIdsByParent.set(parentKey, createdIds);

    return { taskId: task.id, status: task.status, description, targetDepartment, targetSkill, afterId };
  };
