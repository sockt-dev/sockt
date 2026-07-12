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
  /** This worker's own department — create_task subtasks default to this
   * department when the model doesn't explicitly set one, instead of being
   * untagged and claimable by any worker in any department. */
  department: string;
  /** Mutable ref the caller updates to the currently-executing task id before
   * each executeTask() call, so create_task can set the right parentId even
   * though this registry (and its handlers) are built once per process and
   * shared across every task the process ever runs. */
  currentTaskId: { value?: string };
  /** Tracks descriptions already delegated per parent task id, so repeated
   * re-plans within one execution don't re-create the same subtask. Caller
   * should clear the entry for a task id once that task finishes. */
  createdByParent: Map<string, Set<string>>;
  /** Tracks taskIds (not descriptions) created per parent task id, so a
   * later create_task's "after" ordering reference can be validated against
   * a real subtask this execution created. Same clear-on-finish lifecycle
   * as createdByParent. */
  createdIdsByParent: Map<string, Set<string>>;
  /** When true, exec_code refuses to run (throws) instead of silently
   * falling back to an unsandboxed temp dir when sbx is unavailable. A human
   * approving a gated exec_code call (see APPROVAL_REQUIRED_TOOLS) is
   * approving an *isolated* action — falling back silently would make that
   * approval mean less than it looks like. See EXEC_CODE_REQUIRE_SANDBOX in
   * serve.ts. */
  requireSandbox?: boolean;
  /** Sent as `Authorization: Bearer <apiToken>` by create_task's direct
   * fetch to orch — see HttpOrchClientConfig.apiToken for the matching
   * rationale. */
  apiToken?: string;
}

export function registerBuiltInTools(registry: ToolRegistry, opts?: BuiltInToolOptions): void {
  registry.register(webSearchDefinition, webSearchHandler);
  registry.register(writeFileDefinition, writeFileHandler);
  registry.register(readFileDefinition, readFileHandler);
  registry.register(httpRequestDefinition, httpRequestHandler);
  registry.register(execCodeDefinition, makeExecCodeHandler(opts?.agentId ?? "default", opts?.requireSandbox ?? false));
  registry.register(askUserDefinition, askUserHandler);

  if (opts) {
    registry.register(
      createTaskDefinition,
      makeCreateTaskHandler(
        opts.orchUrl,
        opts.tenantId,
        opts.department,
        opts.currentTaskId,
        opts.createdByParent,
        opts.createdIdsByParent,
        opts.apiToken,
      ),
    );
  }
}
