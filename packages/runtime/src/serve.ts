import { AgentRunner } from "./runner/agent-runner.ts";
import { HttpOrchClient } from "./orch-client/client.ts";
import { HttpLlmClient } from "./llm/http-client.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { registerBuiltInTools } from "./tools/built-in/index.ts";
import type { AgentConfig, LlmConfig } from "@sockt/types";

const orchUrl = process.env.ORCH_URL ?? "http://localhost:3100";
const deploymentId = process.env.DEPLOYMENT_ID ?? "default";
const agentRole = process.env.AGENT_ROLE ?? "worker";
const department = process.env.DEPARTMENT ?? "general";
const provider = process.env.MODEL_PROVIDER ?? "anthropic";
const model = process.env.FRONTIER_MODEL ?? "claude-sonnet-4-20250514";
const apiKey = process.env.MODEL_API_KEY ?? "";
const baseUrl = process.env.MODEL_BASE_URL || undefined;
const scratchDir = process.env.SCRATCH_DIR ?? `${process.env.HOME}/.sockt/scratch`;

const llmConfig: LlmConfig = {
  provider: provider as LlmConfig["provider"],
  model,
  apiKey,
  baseUrl,
  maxTokens: 4096,
  temperature: 0.7,
};

const agentConfig: AgentConfig = {
  id: `${department}-${agentRole}-${process.pid}`,
  tenantId: deploymentId,
  name: agentRole,
  role: "worker",
  llmConfig,
  systemPrompt: `You are a ${agentRole} agent in the ${department} department.`,
  tools: [],
  department,
};

const toolRegistry = new ToolRegistry();
registerBuiltInTools(toolRegistry);

const llmClient = new HttpLlmClient(llmConfig);

const runner = new AgentRunner({
  llmClient,
  toolRegistry,
  orchBaseUrl: orchUrl,
});

const orchClient = new HttpOrchClient({ baseUrl: orchUrl });

console.log(`[runtime] agent=${agentRole} dept=${department} polling ${orchUrl}`);

const POLL_INTERVAL_MS = 5000;

while (true) {
  try {
    const tasks = await orchClient.listPending(deploymentId);
    for (const task of tasks) {
      try {
        const claimed = await orchClient.claim(task.id, agentConfig.id);
        const outcome = await runner.executeTask(agentConfig, claimed);
        if (outcome.status === "completed") {
          await orchClient.complete(task.id, outcome.output);
        } else if (outcome.status === "escalated") {
          await orchClient.escalate(task.id, outcome.reason);
        }
      } catch {
        // Task may have been claimed by another agent
      }
    }
  } catch {
    // Orch may not be ready yet, retry on next poll
  }
  await Bun.sleep(POLL_INTERVAL_MS);
}
