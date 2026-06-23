import type { LlmConfig } from "../types/llm.ts";
import type { LlmRequest } from "../schemas/llm.schema.ts";

export interface ModelSelectionContext {
  taskId: string;
  tenantId: string;
  previousAttempts: number;
  budgetRemaining: number;
}

export interface ModelSelector {
  select(request: LlmRequest, context: ModelSelectionContext): Promise<LlmConfig>;
}
