import { SocktError } from "./base.ts";

export class SandboxError extends SocktError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SANDBOX_ERROR", context);
    this.name = "SandboxError";
  }
}
