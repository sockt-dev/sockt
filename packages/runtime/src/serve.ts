import { AgentRunner } from "./runner/agent-runner.ts";
import { HttpOrchClient } from "./orch-client/client.ts";
import { HttpLlmClient } from "./llm/http-client.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { registerBuiltInTools } from "./tools/built-in/index.ts";
import type { AgentConfig, LlmConfig } from "@sockt/types";

const orchUrl      = process.env.ORCH_URL       ?? "http://localhost:3100";
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
  systemPrompt: `You are a ${agentRole} agent in the ${department} department. Complete tasks thoroughly and concisely.`,
  tools: ["web_search", "write_file", "read_file", "create_task", "http_request"],
  department,
  maxConcurrentTasks: maxConcurrent,
};

const toolRegistry = new ToolRegistry();
registerBuiltInTools(toolRegistry, { orchUrl, tenantId: deploymentId });

const llmClient = new HttpLlmClient(llmConfig);
const orchClient = new HttpOrchClient({ baseUrl: orchUrl });

const runner = new AgentRunner({
  llmClient,
  toolRegistry,
  orchBaseUrl: orchUrl,
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
      for (const task of pending) {
        if (activeTasks >= maxConcurrent) break;
        activeTasks++;
        // Execute concurrently without blocking the poll loop
        ;(async () => {
          try {
            const claimed = await orchClient.claim(task.id, agentConfig.id);
            console.log(`[runtime] claimed task=${task.id}`);
            const outcome = await runner.executeTask(agentConfig, claimed);
            if (outcome.status === "completed") {
              await orchClient.complete(task.id, outcome.output);
              console.log(`[runtime] completed task=${task.id}`);
            } else if (outcome.status === "escalated") {
              await orchClient.escalate(task.id, outcome.reason);
              console.log(`[runtime] escalated task=${task.id} reason=${outcome.reason}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!msg.includes("unavailable") && !msg.includes("409")) {
              console.error(`[runtime] task=${task.id} error: ${msg}`);
              try { await orchClient.escalate(task.id, msg); } catch {}
            }
          } finally {
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
