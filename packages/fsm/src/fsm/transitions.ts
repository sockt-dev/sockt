import type { TaskStatus } from "@sockt/types";

export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "escalated", "blocked", "cancelled"],
  completed: [],
  escalated: ["pending", "cancelled"],
  blocked: ["pending", "cancelled"],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
