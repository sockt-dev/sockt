import type { TaskStatus } from "@sockt/types";

export interface BudgetCheckResult {
  allowed: boolean;
  used: number;
  budget: number;
  remaining: number;
  autoEscalated: boolean;
}

export interface CreationValidation {
  valid: boolean;
  reason?: string;
}

export interface FsmTransitionRule {
  from: TaskStatus;
  to: TaskStatus[];
}
