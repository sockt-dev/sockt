import type { Task, TaskCreate, TaskPatch } from "../schemas/task.schema.ts";

export interface TaskStore {
  create(task: TaskCreate): Promise<Task>;
  get(id: string): Promise<Task | null>;
  claim(taskId: string, owner: string): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  listPending(tenantId: string): Promise<Task[]>;
  listByParent(parentId: string): Promise<Task[]>;
  incrementLlmCalls(taskId: string): Promise<{ remaining: number }>;
  delete(id: string): Promise<void>;
}
