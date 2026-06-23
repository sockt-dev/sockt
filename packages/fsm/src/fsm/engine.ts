import type { Task, TaskStatus, AgentRole } from "@sockt/types";
import { TaskStoreError } from "@sockt/types";
import type { SqliteTaskStore } from "../store/sqlite-task-store.ts";
import type { BudgetCheckResult, CreationValidation } from "./budget.ts";
import { canTransition } from "./transitions.ts";

export type { CreationValidation };

export class FsmEngine {
  private readonly store: SqliteTaskStore;

  constructor(store: SqliteTaskStore) {
    this.store = store;
  }

  async transition(
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    _actor: string
  ): Promise<Task> {
    if (!canTransition(from, to)) {
      throw new TaskStoreError(
        `Invalid transition from '${from}' to '${to}'`,
        { taskId, from, to }
      );
    }

    const task = await this.store.get(taskId);
    if (!task) {
      throw new TaskStoreError("Task not found", { taskId });
    }

    if (task.status !== from) {
      throw new TaskStoreError(
        `Task status mismatch: expected '${from}', got '${task.status}'`,
        { taskId, expected: from, actual: task.status }
      );
    }

    return this.store.update(taskId, { status: to });
  }

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return canTransition(from, to);
  }

  async checkBudget(taskId: string): Promise<BudgetCheckResult> {
    const task = await this.store.get(taskId);
    if (!task) {
      throw new TaskStoreError("Task not found", { taskId });
    }

    const remaining = task.llmCallsBudget - task.llmCallsUsed;

    if (remaining <= 0 && task.status === "in_progress") {
      await this.store.update(taskId, { status: "escalated" });
      return {
        allowed: false,
        used: task.llmCallsUsed,
        budget: task.llmCallsBudget,
        remaining: 0,
        autoEscalated: true,
      };
    }

    if (remaining <= 0) {
      return {
        allowed: false,
        used: task.llmCallsUsed,
        budget: task.llmCallsBudget,
        remaining: 0,
        autoEscalated: false,
      };
    }

    return {
      allowed: true,
      used: task.llmCallsUsed,
      budget: task.llmCallsBudget,
      remaining,
      autoEscalated: false,
    };
  }

  validateCreation(
    parentId: string | null,
    role: AgentRole
  ): CreationValidation {
    if (role === "worker" && parentId === null) {
      return {
        valid: false,
        reason: "Worker agents cannot create top-level tasks",
      };
    }
    return { valid: true };
  }
}
