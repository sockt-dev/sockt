import { SocktError } from "./base.ts";

export class LlmError extends SocktError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "LLM_ERROR", context);
    this.name = "LlmError";
  }
}
