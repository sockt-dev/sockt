export const TaskStatus = {
  Pending: "pending",
  InProgress: "in_progress",
  Completed: "completed",
  Escalated: "escalated",
  Blocked: "blocked",
  Cancelled: "cancelled",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUS_VALUES = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];

export interface TaskCreate {
  tenantId: string;
  description: string;
  parentId?: string;
  llmCallsBudget?: number;
  maxAttempts?: number;
  targetDepartment?: string;
  targetRole?: string;
}

export interface TaskPatch {
  status?: TaskStatus;
  owner?: string | null;
  output?: string | null;
  /** Only patched by the clarifying-question resume flow, to append the
   * human's answer so the next Plan phase sees it as part of the task. */
  description?: string;
  llmCallsUsed?: number;
  attemptCount?: number;
}
