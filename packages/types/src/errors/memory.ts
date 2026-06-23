import { SocktError } from "./base.ts";

export class MemoryError extends SocktError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "MEMORY_ERROR", context);
    this.name = "MemoryError";
  }
}
