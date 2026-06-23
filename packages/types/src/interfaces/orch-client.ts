import type { Task, TaskCreate } from "../schemas/task.schema.ts";

export interface OrchClient {
  claim(taskId: string, agentId: string): Promise<Task>;
  complete(taskId: string, output: string): Promise<void>;
  escalate(taskId: string, reason: string): Promise<void>;
  recordLlmCall(taskId: string): Promise<{ allowed: boolean; remaining: number }>;
  listPending(tenantId: string): Promise<Task[]>;
  createTask(task: TaskCreate): Promise<Task>;
}
