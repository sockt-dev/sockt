import type { ToolDefinition } from "@sockt/types";
import type { ToolHandler } from "../../types.ts";

export const createTaskDefinition: ToolDefinition = {
  name: "create_task",
  description: "Create a subtask in the orchestrator. Use this to delegate work to other agents or queue follow-up work.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the subtask should accomplish" },
      budget: { type: "number", description: "Max LLM calls for the subtask (default 10)" },
    },
    required: ["description"],
  },
};

export const makeCreateTaskHandler = (orchUrl: string, tenantId: string, parentTaskId?: string): ToolHandler =>
  async (args) => {
    const description = String(args.description ?? "");
    const budget = Number(args.budget ?? 10);

    const res = await fetch(`${orchUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        description,
        llmCallsBudget: budget,
        parentId: parentTaskId,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
    const task = await res.json() as { id: string; status: string };
    return { taskId: task.id, status: task.status, description };
  };
