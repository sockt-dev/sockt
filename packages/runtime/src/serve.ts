import { homedir } from "node:os";
import { AgentRunner } from "./runner/agent-runner.ts";
import { HttpOrchClient } from "./orch-client/client.ts";
import { HttpLlmClient } from "./llm/http-client.ts";
import { HttpHitlGate } from "./hitl/http-hitl-gate.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { registerBuiltInTools } from "./tools/built-in/index.ts";
import { getSystemPrompt } from "./prompts/department-prompts.ts";
import type { AgentConfig, LlmConfig } from "@sockt/types";

// Neither Bun's .env loader nor node:fs expand a leading "~" — left unexpanded,
// paths like "~/.sockt/scratch" resolve to a literal "~" directory relative to cwd.
function expandHome(path: string): string {
  return path.startsWith("~") ? path.replace(/^~/, homedir()) : path;
}

const orchUrl      = process.env.ORCH_URL       ?? "http://localhost:3100";
// Must match the orch process's own ORCH_API_TOKEN (see SECURITY.md #5) —
// unset by default, matching orch's own no-auth-by-default behavior.
const orchApiToken = process.env.ORCH_API_TOKEN || undefined;
const deploymentId = process.env.DEPLOYMENT_ID  ?? "default";
const agentRole    = (process.env.AGENT_ROLE    ?? "worker") as "worker" | "architect";
const department   = process.env.DEPARTMENT     ?? "general";
const provider     = process.env.MODEL_PROVIDER ?? "anthropic";
const model        = process.env.FRONTIER_MODEL ?? "llama-3.1-8b-instant";
const apiKey       = process.env.MODEL_API_KEY  ?? "";
const baseUrl      = process.env.MODEL_BASE_URL || undefined;
const maxConcurrent = Number(process.env.MAX_CONCURRENT ?? 1);

const llmConfig: LlmConfig = {
  provider: provider as LlmConfig["provider"],
  model,
  apiKey,
  baseUrl,
  maxTokens: Number(process.env.MAX_TOKENS ?? 4096),
  temperature: 0.7,
};

const agentConfig: AgentConfig = {
  id: `${department}-${agentRole}-${process.pid}`,
  tenantId: deploymentId,
  name: `${department} ${agentRole}`,
  role: agentRole,
  llmConfig,
  systemPrompt: getSystemPrompt(department, agentRole),
  tools: ["web_search", "write_file", "read_file", "create_task", "http_request", "exec_code"],
  department,
  maxConcurrentTasks: maxConcurrent,
};

// See BuiltInToolOptions.currentTaskId — updated before each executeTask() call
// below so create_task can set the right parentId, and createdByParent — which
// dedupes repeated create_task calls for the same deliverable across re-plan
// cycles. Both are only safe because maxConcurrent tasks share one mutable
// ref/map; guarded below since MAX_CONCURRENT > 1 would race between
// concurrently-executing tasks on the same worker process.
if (maxConcurrent > 1) {
  throw new Error(
    "MAX_CONCURRENT > 1 is not yet safe: currentTaskId/createdByParent in serve.ts are shared " +
    "mutable state across concurrently-executing tasks on one worker process and would race. " +
    "Either fix that (thread task-scoped state through executeTask instead of module-level refs) " +
    "or keep MAX_CONCURRENT=1.",
  );
}
const currentTaskId: { value?: string } = {};
const createdByParent = new Map<string, Set<string>>();
const createdIdsByParent = new Map<string, Set<string>>();

// Whether exec_code refuses to run rather than silently falling back to an
// unsandboxed temp dir when sbx is unavailable. Defaults to true for engops
// (same rationale as the exec_code approval gate below — approving a gated
// exec_code call should mean the action is actually isolated, not just that
// a human clicked a button). EXEC_CODE_REQUIRE_SANDBOX always overrides when
// set (including "" to force-disable). Added in Phase 3 after finding sbx
// wasn't actually installed on the dev machine despite being gated on —
// every "approved" exec_code call had silently been running unsandboxed.
const requireSandboxDefault = department === "engops";
const requireSandbox = process.env.EXEC_CODE_REQUIRE_SANDBOX !== undefined
  ? process.env.EXEC_CODE_REQUIRE_SANDBOX === "true"
  : requireSandboxDefault;

const toolRegistry = new ToolRegistry();
registerBuiltInTools(toolRegistry, { orchUrl, tenantId: deploymentId, agentId: agentConfig.id, department, currentTaskId, createdByParent, createdIdsByParent, requireSandbox, apiToken: orchApiToken });

// Comma-separated tool names that require human approval before running,
// e.g. "exec_code,http_request". APPROVAL_REQUIRED_TOOLS always wins when
// set. Otherwise engops defaults to gating exec_code — arbitrary shell
// execution against real infra is the highest-blast-radius tool in the
// registry, and engops is the only department whose prompts (runbooks,
// deploys, rollbacks) routinely ask for it. Every other department defaults
// to no gate. Rollout decision from the 2026-07-12 Phase 2 build.
const defaultApprovalRequiredTools = department === "engops" ? "exec_code" : "";
const approvalRequiredTools = (process.env.APPROVAL_REQUIRED_TOOLS ?? defaultApprovalRequiredTools)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
if (approvalRequiredTools.length > 0) {
  toolRegistry.setApprovalRequired(approvalRequiredTools);
}

const hitlGate = new HttpHitlGate({
  baseUrl: orchUrl,
  pollIntervalMs: Number(process.env.HITL_POLL_INTERVAL_MS ?? 2000),
  apiToken: orchApiToken,
});

const llmClient = new HttpLlmClient(llmConfig);
const orchClient = new HttpOrchClient({ baseUrl: orchUrl, apiToken: orchApiToken });

// Department-specific skills directory — SkillCompiler loads .skill JSON files from here
// Defaults to the bundled department skills inside the monorepo
const defaultSkillsDir = new URL(
  `../../orch/src/registry/skills/${department}`,
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1"); // strip leading slash on Windows paths

const skillsDir = process.env.SKILLS_DIR ?? defaultSkillsDir;

// Full Plan/Act/Observe/Reflect execution trace, one JSONL line per finished task.
// Set TRACE_LOG_PATH="" to disable. Consumed by evals/trace-capture.ts.
const scratchDir = expandHome(process.env.SCRATCH_DIR ?? `${homedir()}/.sockt/scratch`);
const traceLogPath = expandHome(process.env.TRACE_LOG_PATH ?? `${scratchDir}/traces.jsonl`);

// See verification/output-gate.ts and docs/ARCHITECTURE.md's output gate
// section. Default on — set OUTPUT_GATE_ENABLED=false to accept every
// completion as-is (e.g. for local debugging without a skills dir).
const outputGateEnabled = process.env.OUTPUT_GATE_ENABLED !== "false";

const runner = new AgentRunner({
  llmClient,
  toolRegistry,
  orchBaseUrl: orchUrl,
  skillsDir,
  traceLogPath: traceLogPath || undefined,
  hitlGate,
  orchApiToken,
  outputGateEnabled,
});

// Self-register with orchestrator (retry until orch is ready)
async function registerSelf(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await orchClient.registerAgent(agentConfig);
      console.log(`[runtime] registered agent=${agentConfig.id} dept=${department}`);
      return;
    } catch {
      await Bun.sleep(2000);
    }
  }
  console.warn("[runtime] could not register with orch — proceeding anyway");
}

await registerSelf();
console.log(`[runtime] polling ${orchUrl} every 5s`);

const POLL_MS = 5000;
let activeTasks = 0;

while (true) {
  try {
    if (activeTasks < maxConcurrent) {
      const pending = await orchClient.listPending(deploymentId);
      // Department and role are enforced independently, not only when BOTH
      // are set — that was the actual bug behind cross-department claiming
      // (a growth subtask with targetDepartment set but no targetRole used
      // to fall through to "any worker", including engops/product workers
      // running the wrong system prompt entirely). create_task now always
      // sets targetDepartment (defaulting to the caller's own), so this
      // path is the common case for every subtask going forward.
      const claimable = pending.filter((t) => {
        if (t.targetDepartment && t.targetDepartment !== department) return false;
        if (t.targetRole) return t.targetRole === agentRole;
        // Untagged role (e.g. a legacy/top-level task with no targetRole) goes
        // to workers only, so architects never grab a worker-shaped subtask.
        return agentRole === "worker";
      });
      for (const task of claimable) {
        if (activeTasks >= maxConcurrent) break;
        activeTasks++;
        // Execute concurrently without blocking the poll loop
        ;(async () => {
          try {
            const claimed = await orchClient.claim(task.id, agentConfig.id);
            console.log(`[runtime] claimed task=${task.id}`);
            currentTaskId.value = claimed.id;
            const outcome = await runner.executeTask(agentConfig, claimed);
            if (outcome.status === "completed") {
              await orchClient.complete(task.id, outcome.output, agentConfig.id);
              console.log(`[runtime] completed task=${task.id}`);
            } else if (outcome.status === "escalated") {
              await orchClient.escalate(task.id, outcome.reason, agentConfig.id);
              console.log(`[runtime] escalated task=${task.id} reason=${outcome.reason}`);
            } else if (outcome.status === "blocked") {
              await orchClient.block(task.id, outcome.dependency, agentConfig.id);
              console.log(`[runtime] blocked task=${task.id} dependency=${outcome.dependency}`);
            } else if (outcome.status === "needs_input") {
              await orchClient.requestInput(task.id, outcome.question, agentConfig.id);
              console.log(`[runtime] needs_input task=${task.id} question=${outcome.question}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes("unavailable") && !msg.includes("409")) {
              console.error(`[runtime] task=${task.id} error: ${msg}`);
              try { await orchClient.escalate(task.id, msg, agentConfig.id); } catch {}
            }
          } finally {
            createdByParent.delete(task.id);
            createdIdsByParent.delete(task.id);
            activeTasks--;
          }
        })();
      }
    }
  } catch {
    // Orch not ready yet
  }
  await Bun.sleep(POLL_MS);
}
