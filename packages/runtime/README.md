# @sockt/runtime

The agent execution engine — the Plan → Act → Observe → Reflect loop, an LLM client wrapping Anthropic/OpenAI/Groq/Bedrock/Ollama, a built-in tool registry (`web_search`, `exec_code`, `create_task`, `write_file`/`read_file`, `http_request`), Docker AI Sandbox integration, and the skill-matching system that lets agents draw on prior successful executions.

This is what actually runs when an agent claims a task — everything else in Sockt (orch, fsm, memory) exists to coordinate and bound what happens here.

## Install

```bash
bun add @sockt/runtime
```

## What's in here

### `AgentRunner`

The execution loop itself. Given an `AgentConfig` and a claimed `Task`, runs Plan → Act → Observe → Reflect until the task completes, escalates, or the budget runs out — whichever comes first.

```typescript
import { AgentRunner, HttpLlmClient, ToolRegistry, registerBuiltInTools } from "@sockt/runtime";

const toolRegistry = new ToolRegistry();
registerBuiltInTools(toolRegistry, { orchUrl: "http://localhost:3100", tenantId: "acme", agentId: "worker-1" });

const runner = new AgentRunner({
  llmClient: new HttpLlmClient({ provider: "anthropic", model: "claude-sonnet-4-6-20250514", apiKey: process.env.MODEL_API_KEY }),
  toolRegistry,
  orchBaseUrl: "http://localhost:3100",
});

const outcome = await runner.executeTask(agentConfig, claimedTask);
// outcome.status: "completed" | "escalated" | "blocked"
```

### `HttpLlmClient`

Wraps the Vercel AI SDK across providers — `anthropic`, `openai`, `groq`, `bedrock`, `ollama`, plus any OpenAI-compatible custom endpoint via `baseUrl`. Handles retry with backoff (longer backoff specifically for `429` rate limits), a 90s timeout per call, and an optional inter-call throttle (`LLM_CALL_DELAY_MS`) for free-tier rate limits.

### Built-in tools (`registerBuiltInTools`)

| Tool | What it does |
|---|---|
| `web_search` | Brave Search if `BRAVE_SEARCH_API_KEY` is set, else DuckDuckGo instant answers |
| `write_file` / `read_file` | I/O against the agent's scratch directory |
| `http_request` | Generic HTTP fetch with a basic SSRF guard |
| `create_task` | Creates a subtask on the orchestrator with `parentId` set — how architect agents delegate |
| `exec_code` | Runs Python/JS/TS/Bash inside a Docker AI Sandbox microVM if `sbx` is installed, else an unsandboxed temp dir with a warning |

### `ToolRegistry`

Register custom tools alongside the built-ins. Supports marking specific tools as requiring human approval (`requiresApproval`) — the runner will pause and call the configured `HitlGate` before executing them.

### `SbxSandbox` / `DockerSandbox`

`SbxSandbox` wraps the [Docker AI Sandbox](https://docs.docker.com/ai/sandboxes/) CLI for microVM-isolated code execution (what `exec_code` uses). `DockerSandbox` is a lower-level raw-Docker-socket implementation for container lifecycle management outside the sandbox CLI.

### `SkillCompiler`

After a task completes successfully, compiles its execution trace into a reusable `.skill` file. On future tasks, `findRelevant()` scores existing skills against the new task's description (Jaccard similarity via `scoreRelevance`) and injects the best matches as context — this is separate from, and complements, the pre-written department skill indexes described in [docs/DEPARTMENTS.md](https://github.com/sockt-dev/sockt/blob/main/docs/DEPARTMENTS.md).

### `ExecutionTrace`

Records every Plan/Act/Observe/Reflect step for a task run — what CADVP later tails from the JSONL log and what `SkillCompiler` compiles from.

### `HttpOrchClient`

The orchestrator API client this package uses internally (claim/complete/escalate/record-llm-call/register-agent) — exported in case you're building a custom worker loop instead of using `AgentRunner`.

## Environment variables

Full reference: [docs/CONFIGURATION.md](https://github.com/sockt-dev/sockt/blob/main/docs/CONFIGURATION.md). The ones specific to this package: `MODEL_PROVIDER`, `MODEL_API_KEY`, `FRONTIER_MODEL`, `MAX_TOKENS`, `LLM_CALL_DELAY_MS`, `PLAN_CONTEXT_MESSAGES`, `SKILLS_DIR`, `BRAVE_SEARCH_API_KEY`.

## Docs

Agent execution loop and tool isolation model: [docs/ARCHITECTURE.md#agent-execution-loop](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md#agent-execution-loop)

Sandbox security boundaries: [SECURITY.md](https://github.com/sockt-dev/sockt/blob/main/SECURITY.md)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
