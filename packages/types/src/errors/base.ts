export class SocktError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.context = context;
    this.name = "SocktError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
