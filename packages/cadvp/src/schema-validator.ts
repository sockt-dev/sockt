import { CadvpEventSchema, type CadvpEvent } from "@sockt/types";

export type ValidationResult =
  | { ok: true; event: CadvpEvent }
  | { ok: false; error: string; raw: string };

export class SchemaValidator {
  validate(jsonLine: string): ValidationResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonLine);
    } catch {
      return { ok: false, error: "Invalid JSON", raw: jsonLine };
    }

    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Not an object", raw: jsonLine };
    }

    const normalized = this.normalizeEntry(parsed as Record<string, unknown>);
    const result = CadvpEventSchema.safeParse(normalized);

    if (!result.success) {
      return { ok: false, error: result.error.message, raw: jsonLine };
    }

    return { ok: true, event: result.data };
  }

  private normalizeEntry(raw: Record<string, unknown>): Record<string, unknown> {
    const entry = (raw.entry ?? {}) as Record<string, unknown>;
    return {
      ...raw,
      entry: {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        createdAt: entry.createdAt ?? new Date().toISOString(),
      },
    };
  }
}
