import { SocktError } from "./base.ts";

export class TaskStoreError extends SocktError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "TASK_STORE_ERROR", context);
    this.name = "TaskStoreError";
  }
}
