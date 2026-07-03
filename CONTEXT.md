# Sockt — Technical Context

## What This Is

Sockt is an open-core TypeScript platform for deploying coordinated AI agent swarms ("Agent Teams"). It solves three hard production problems with multi-agent systems:

| Problem | Solution |
|---------|----------|
| Runaway loops (agents ping-pong, burning API budget) | FSM-enforced task lifecycle + LLM call budget per task |
| Memory loss across runs | CADVP daemon tails JSONL logs → deduped vector memory |
| Credential leakage via prompt injection | Hardware-isolated credential vaults (planned) |

## Monorepo Structure

```
packages/
  types/    — shared Zod schemas, interfaces, error classes
  fsm/      — SQLite-backed task state machine + budget guard
  memory/   — vector search, RRF ranking, dedup, MCP brain client
  orch/     — orchestrator HTTP API, agent registry, scheduler, router
  runtime/  — agent execution loop (Plan→Act→Observe→Reflect)
  cadvp/    — JSONL tail daemon, event batching, checkpoint store
schemas/    — generated JSON schemas from types package
index.ts    — root placeholder (not the real entry point)
```

## Tech Stack

- **Runtime**: Bun (not Node.js — use `bun` everywhere)
- **Language**: TypeScript strict mode, ESNext
- **DB**: `bun:sqlite` (SQLite, not better-sqlite3)
- **HTTP**: Hono (not Express)
- **Validation**: Zod + zod-to-json-schema
- **LLM SDKs**: Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`)
- **Scheduling**: node-cron
- **Testing**: `bun test` (55 test files)

## Package Details

### `@sockt/types`
Foundation layer. All cross-package types live here.

Key enums: `TaskStatus`, `AgentRole`, `LlmProvider`, `MessageRole`, `RoutingStrategy`, `Platform`, `HitlTier`, `CadvpEventType`, `MemoryCategory`

Key interfaces: `TaskStore`, `MemoryStore`, `LlmClient`, `Sandbox`, `HitlGate`, `ChannelGateway`, `OrchClient`, `TelemetryEmitter`, `ModelSelector`

Error classes: `SocktError`, `TaskStoreError`, `MemoryError`, `LlmError`, `SandboxError`, `HitlError`

### `@sockt/fsm`
Task lifecycle engine. Enforces valid state transitions and budget caps.

**State machine:**
```
pending → in_progress → completed
              ↓              
          escalated → pending
              ↓
           blocked → pending
              ↓
          cancelled
```

Key classes: `FsmEngine`, `SqliteTaskStore`, `TaskClaimLock`, `BudgetCheckResult`

Budget guard: each task has `llmCallsBudget`. When `llmCallsUsed` hits the cap, the task auto-escalates instead of looping.

### `@sockt/memory`
Vector-based memory retrieval with deduplication.

Key classes: `GBrainMcpClient` (external brain via MCP), `DedupGate` (cosine similarity dedup at 0.92 threshold), `RrfRanker` (Reciprocal Rank Fusion for multi-source ranking)

Factory: `createMemoryStore(config)` returns the appropriate backend.

### `@sockt/orch`
Central coordination hub.

Key classes: `Orchestrator`, `OrchestratorApi` (Hono HTTP server), `MessageRouter`, `AgentRegistry`, `DepartmentManager`, `Scheduler`, `LockManager`

Exposes HTTP endpoints for task claim/completion, agent registration, health checks.

### `@sockt/runtime`
Executes individual agent tasks.

**Execution loop:** Plan → Act → Observe → Reflect

Key classes: `AgentRunner`, `ConfigBasedSelector` (model selection), `HttpLlmClient`, `DockerSandbox`, `ToolRegistry`, `SkillCompiler`, `ExecutionTrace`, `HttpOrchClient`

Supports: Anthropic, OpenAI, Google, Ollama providers.

### `@sockt/cadvp`
Continuous Activity/Event monitoring daemon.

Tails JSONL log files → validates events → deduplicates → batches → flushes to memory store.

Key classes: `CadvpDaemon`, `JsonlTailer`, `EventProcessor`, `CheckpointStore`, `SchemaValidator`

Defaults: `dedupThreshold: 0.92`, `batchSize: 10`, `flushIntervalMs: 2000`, `pollIntervalMs: 500`

## Core Data Models

### Task
```typescript
{
  id: string
  tenantId: string
  status: TaskStatus       // pending | in_progress | completed | escalated | blocked | cancelled
  owner?: string           // agent ID currently holding this task
  parentId?: string        // subtask relationship
  description: string
  output?: string
  llmCallsUsed: number
  llmCallsBudget: number
  attemptCount: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
}
```

### AgentConfig
```typescript
{
  id: string
  tenantId: string
  name: string
  role: "architect" | "worker"   // architects spawn subtasks, workers execute
  llmConfig: LlmConfig
  systemPrompt: string
  tools: string[]
  department?: string
  maxConcurrentTasks?: number
}
```

### LlmConfig
```typescript
{
  provider: "anthropic" | "openai" | "google" | "ollama"
  model: string
  temperature?: number
  maxTokens?: number
}
```

## Startup Flow

1. `new Orchestrator(config)` — initializes SQLite DB, FSM engine, API server
2. Agents register via `AgentRegistry.register(agentConfig)`
3. Tasks created via `TaskStore.create()` → FSM validates initial state
4. Agents poll and claim tasks via `POST /tasks/claim` → state moves to `in_progress`
5. `AgentRunner.executeTask()` runs the Plan→Act→Observe→Reflect loop
6. Execution writes JSONL logs → `CadvpDaemon` tails them → memory updated

## Workspace Commands

```bash
bun install                          # install all deps
bun run build                        # build all packages
bun test                             # run all tests (55 files)
bun run lint                         # eslint all packages
bun run generate-schemas             # regenerate JSON schemas from types
```

## Architectural Patterns

- **Dependency injection** — all dependencies passed via constructors
- **Interface-first** — `TaskStore`, `MemoryStore`, `LlmClient` are abstractions; implementations are swappable
- **Factory functions** — `createMemoryStore()`, `createTestDb()`
- **Zod validation** at all system boundaries (not inside packages)
- **SQLite with prepared statements** — all DB access via `bun:sqlite`
- **Event-driven memory** — agents don't write memory directly; CADVP processes logs asynchronously
- **Multi-tenancy** — every resource is scoped by `tenantId`

## License

Functional Source License 1.1 with MIT Future. Non-competing use permitted immediately. Converts to MIT automatically after 2 years from each release.

## What's Missing / Planned

- Rust components referenced in README but not present in repo yet
- Hardware-isolated credential vaults (mentioned in README, not implemented)
- Frontend/UI — no web interface in repo currently
- Docker deployment configs
