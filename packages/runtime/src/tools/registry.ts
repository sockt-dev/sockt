import type { ToolDefinition, ToolCall } from "@sockt/types";
import type { ToolHandler, ToolExecutionResult } from "../types.ts";

export class ToolRegistry {
  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();
  private approvalRequired = new Set<string>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Unknown tool: ${call.name}`,
        durationMs: 0,
      };
    }

    const start = performance.now();
    try {
      const output = await tool.handler(call.arguments);
      return { success: true, output, durationMs: performance.now() - start };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - start,
      };
    }
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  requiresApproval(toolName: string): boolean {
    return this.approvalRequired.has(toolName);
  }

  setApprovalRequired(toolNames: string[]): void {
    for (const name of toolNames) this.approvalRequired.add(name);
  }

  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }
}
