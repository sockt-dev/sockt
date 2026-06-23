import { SocktError } from "./base.ts";

export class HitlError extends SocktError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "HITL_ERROR", context);
    this.name = "HitlError";
  }
}
