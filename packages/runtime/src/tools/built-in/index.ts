import type { ToolRegistry } from "../registry.ts";
import { webSearchDefinition, webSearchHandler } from "./web_search.ts";
import { writeFileDefinition, writeFileHandler, readFileDefinition, readFileHandler } from "./file_ops.ts";
import { httpRequestDefinition, httpRequestHandler } from "./http_request.ts";
import { createTaskDefinition, makeCreateTaskHandler } from "./create_task.ts";
import { execCodeDefinition, makeExecCodeHandler } from "./exec_code.ts";
import { askUserDefinition, askUserHandler } from "./ask_user.ts";

export interface BuiltInToolOptions {
  orchUrl: string;
  tenantId: string;
  agentId: string;
  /** Mutable ref the caller updates to the currently-executing task id before
   * each executeTask() call, so create_task can set the right parentId even
   * though this registry (and its handlers) are built once per process and
   * shared across every task the process ever runs. */
  currentTaskId: { value?: string };
  /** Tracks descriptions already delegated per parent task id, so repeated
   * re-plans within one execution don't re-create the same subtask. Caller
   * should clear the entry for a task id once that task finishes. */
  createdByParent: Map<string, Set<string>>;
}

export function registerBuiltInTools(registry: ToolRegistry, opts?: BuiltInToolOptions): void {
  registry.register(webSearchDefinition, webSearchHandler);
  registry.register(writeFileDefinition, writeFileHandler);
  registry.register(readFileDefinition, readFileHandler);
  registry.register(httpRequestDefinition, httpRequestHandler);
  registry.register(execCodeDefinition, makeExecCodeHandler(opts?.agentId ?? "default"));
  registry.register(askUserDefinition, askUserHandler);

  if (opts) {
    registry.register(
      createTaskDefinition,
      makeCreateTaskHandler(opts.orchUrl, opts.tenantId, opts.currentTaskId, opts.createdByParent),
    );
  }
}
