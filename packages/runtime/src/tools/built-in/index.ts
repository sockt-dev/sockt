import type { ToolRegistry } from "../registry.ts";
import { webSearchDefinition, webSearchHandler } from "./web_search.ts";
import { writeFileDefinition, writeFileHandler, readFileDefinition, readFileHandler } from "./file_ops.ts";
import { httpRequestDefinition, httpRequestHandler } from "./http_request.ts";
import { createTaskDefinition, makeCreateTaskHandler } from "./create_task.ts";
import { execCodeDefinition, makeExecCodeHandler } from "./exec_code.ts";

export interface BuiltInToolOptions {
  orchUrl: string;
  tenantId: string;
  agentId: string;
}

export function registerBuiltInTools(registry: ToolRegistry, opts?: BuiltInToolOptions): void {
  registry.register(webSearchDefinition, webSearchHandler);
  registry.register(writeFileDefinition, writeFileHandler);
  registry.register(readFileDefinition, readFileHandler);
  registry.register(httpRequestDefinition, httpRequestHandler);
  registry.register(execCodeDefinition, makeExecCodeHandler(opts?.agentId ?? "default"));

  if (opts) {
    registry.register(
      createTaskDefinition,
      makeCreateTaskHandler(opts.orchUrl, opts.tenantId),
    );
  }
}
