import { z } from "zod";
import { TASK_STATUS_VALUES } from "../types/task.ts";

export const TaskSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  status: z.enum(TASK_STATUS_VALUES),
  owner: z.string().nullable(),
  parentId: z.string().nullable(),
  description: z.string(),
  output: z.string().nullable(),
  llmCallsUsed: z.number().int().nonnegative(),
  llmCallsBudget: z.number().int().positive(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateSchema = z.object({
  tenantId: z.string(),
  description: z.string(),
  parentId: z.string().optional(),
  llmCallsBudget: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskPatchSchema = z.object({
  status: z.enum(TASK_STATUS_VALUES).optional(),
  owner: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
  llmCallsUsed: z.number().int().nonnegative().optional(),
  attemptCount: z.number().int().nonnegative().optional(),
});
export type TaskPatch = z.infer<typeof TaskPatchSchema>;
