# Sockt

AI agent swarms that won't bankrupt you or embarrass you.

Sockt is an open-core platform for deploying coordinated AI agent teams ("Swarms") into your workspace. Swarms divide complex workflows into specialized roles that share persistent memory, enforce cost budgets, and improve automatically over time.

---

## Why Sockt?

Most multi-agent systems fail in production for three reasons:

- **Runaway loops** — agents ping-pong indefinitely, burning thousands in API costs
- **Memory loss** — background tasks forget everything they learned between runs
- **Credential leakage** — API keys exposed in agent context windows via prompt injection

Sockt solves these with a budget-enforced finite state machine for task coordination, a persistent JSONL-backed memory pipeline, and hardware-isolated credential vaults.

---

## Architecture

Sockt is a TypeScript monorepo (Bun runtime) with six core packages, a GBrain MCP memory server, and a Rust CLI:

```text
packages/
  types/      — shared Zod schemas, interfaces, and error classes
  fsm/        — SQLite-backed task state machine with LLM call budget guard
  memory/     — vector search, reciprocal rank fusion, dedup, MCP brain client
  orch/       — orchestrator HTTP API, agent registry, scheduler, message router
  runtime/    — per-agent execution loop: Plan → Act → Observe → Reflect
  cadvp/      — JSONL tail daemon for async memory ingestion and event processing
  gbrain-mcp/ — local MCP memory server (SQLite-backed knowledge store)
  ui/         — local control-plane dashboard (React, Bun.serve)
rust/
  sockt-cli/  — CLI binary (`sockt`) for deployment and operations
```

### How It Works

1. `sockt init` scaffolds config, encrypts your LLM API key, and creates a GBrain directory
2. `sockt deploy` starts gbrain-mcp → orchestrator → CADVP → agent runtimes in order
3. **Architect agents** decompose goals into tasks; **worker agents** claim and execute them
4. The **FSM** enforces valid state transitions and auto-escalates tasks that exceed their LLM call budget
5. The **Runtime** runs a Plan → Act → Observe → Reflect loop per task with full tracing
6. The **CADVP daemon** tails execution logs, deduplicates events (cosine similarity 0.92), and writes to GBrain memory
7. Agents query **GBrain** via vector search + RRF ranking on subsequent tasks

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| CLI | Rust (Tokio, Clap, Reqwest) |
| Runtime | Bun |
| Language | TypeScript (strict) |
| Database | SQLite via `bun:sqlite` |
| HTTP | Hono |
| Validation | Zod |
| LLM providers | Anthropic, OpenAI, Google, Ollama (via Vercel AI SDK) |
| Encryption | age (X25519) |
| Scheduling | node-cron |
| Testing | `bun test` (TS), `cargo test` (Rust) |

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) and [Rust](https://rustup.rs) installed.

```bash
# 1. Clone and install dependencies
git clone https://github.com/sockt-dev/sockt
cd sockt
bun install
cp .env.example .env   # fill in MODEL_API_KEY — see docs/CONFIGURATION.md

# 2. Build the CLI
cd rust/sockt-cli
cargo build --release
# Binary at: rust/target/release/sockt (add to PATH)

# 3. Initialise a deployment
sockt init

# 4. Pre-flight check
sockt doctor

# 5. Deploy the swarm
sockt deploy

# 6. Send your first instruction
sockt ask "Summarise our top 3 competitors"

# 7. Monitor
sockt status
sockt tasks list
```

---

## CLI Reference

```
sockt init              Interactive setup wizard (config, encryption, GBrain scaffold)
sockt deploy            Start gbrain → orch → cadvp → agents
sockt stop              Graceful shutdown
sockt restart [agent]   Restart one or all services
sockt destroy           Remove everything (with preservation flags)
sockt status            Swarm health overview (--watch for live TUI)
sockt health            Per-service health checks with fix suggestions
sockt doctor            Pre-flight environment validation
sockt ask <msg>         Create a task (--wait to poll for result)
sockt tasks list        List tasks (--status, --agent, --since, --json)
sockt tasks show <id>   Full task detail
sockt tasks approve <id> Approve an escalated task (HITL)
sockt tasks reject <id>  Reject with reason
sockt tasks cancel <id>  Cancel at next checkpoint
sockt tasks retry <id>   Re-queue failed/escalated tasks
sockt brain             GBrain summary (files, commits, skills)
sockt brain search <q>  Search knowledge base
sockt brain skills      Manage agent skill definitions
sockt department list   Available department templates
sockt department add    Activate a department (growth | product | engops)
sockt config show       View current configuration
sockt config get <key>  Dot-path value lookup
sockt config set <key>  Update a value
sockt secrets list      Show encrypted secrets
sockt secrets set       Encrypt and store a credential
sockt secrets rotate    Rotate encryption key
sockt setup llm         Reconfigure LLM provider/model
sockt setup integration Connect GitHub, HubSpot, Linear, Sentry, PagerDuty, Apollo
sockt logs              View agent logs (--follow for tail mode)
sockt connect           Live tail of a specific agent
sockt export            Archive GBrain as tar.gz
sockt upgrade           Self-update CLI binary
```

---

## Packages

### `@sockt/types`

All shared types, Zod schemas, and interfaces. The dependency foundation every other package builds on.

Key exports: `Task`, `AgentConfig`, `LlmConfig`, `MemoryEntry`, `CadvpEvent`, `TaskStore`, `MemoryStore`, `LlmClient`

### `@sockt/fsm`

Finite state machine for task lifecycle management. Prevents agents from entering invalid states and enforces per-task LLM call budgets.

Task states: `pending → in_progress → completed | escalated | blocked | cancelled`

### `@sockt/memory`

Semantic memory retrieval with deduplication. Supports MCP-based external brain services, cosine similarity dedup, and Reciprocal Rank Fusion for multi-source ranking.

### `@sockt/orch`

Central coordination hub. Manages the agent registry, routes messages, schedules cron tasks, and exposes the REST API that agents and the CLI talk to.

### `@sockt/runtime`

Executes individual agent tasks. Runs the Plan → Act → Observe → Reflect loop, calls the LLM, invokes tools, collects traces, and optionally runs a reflection phase.

### `@sockt/cadvp`

Continuous monitoring daemon. Tails JSONL execution logs, validates and deduplicates events, batches them, and flushes to the memory store. Checkpoint-based so it resumes after crashes.

### `@sockt/gbrain-mcp`

Local MCP memory server. Exposes a SQLite-backed knowledge store over HTTP for agents and CADVP to read/write without needing a cloud service.

### `@sockt/ui`

Local control-plane dashboard. React app served by `Bun.serve` on port 3001. Provides a kanban task board, agent registry, memory explorer, HITL approvals queue, and CADVP monitor — all connected to a local orchestrator instance.

```bash
bun run ui       # start dashboard at http://localhost:3001
bun run orch     # start orchestrator at http://localhost:3000
```

---

## Departments

Three built-in agent team templates:

| Department | Agents | Tools | Use Case |
| ---------- | ------ | ----- | -------- |
| `growth` | Lead Researcher, Outbound Writer, Social Monitor | Apollo, LinkedIn, HubSpot, Gmail | Find and qualify leads, draft outreach |
| `product` | Product Architect, Coder Agent, QA Tester | GitHub, Linear, code-sandbox | Ship features, fix bugs, write tests |
| `engops` | Eng-Ops Architect, Deploy Worker, Sentry Monitor | Sentry, PagerDuty, Datadog, GitHub | Detect incidents, triage, document resolutions |

```bash
sockt department add growth
sockt deploy
sockt ask "Find 20 leads in Series A SaaS companies in London"
```

---

## Key Concepts

### Agent Roles

- `architect` — decomposes goals into subtasks, does not execute directly
- `worker` — claims and executes tasks within budget

### Task Budget

Every task has `llmCallsBudget`. When `llmCallsUsed` reaches the cap, the FSM auto-escalates rather than looping. This is the primary cost control mechanism.

### Memory Pipeline

Agents never write to memory directly. Execution is logged to JSONL files. The CADVP daemon processes those logs asynchronously and persists deduplicated events to GBrain — keeping the hot execution path lean and safe from injection.

### Multi-tenancy

Every resource (task, agent, memory entry) is scoped by `tenantId`. The orchestrator supports isolated departments within a tenant.

### Human-in-the-Loop (HITL)

Agents escalate tasks that exceed budget or require authorisation. Operators review and approve/reject via `sockt tasks approve/reject` or the UI dashboard.

---

## Documentation

| Doc | What's in it |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the packages fit together, the task FSM, the agent execution loop, the memory pipeline |
| [docs/API.md](docs/API.md) | Full orchestrator HTTP API reference |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable, what reads it, and Groq free-tier tuning |
| [docs/DEPARTMENTS.md](docs/DEPARTMENTS.md) | The skill index pattern, `.skill` file format, adding a department |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, conventions, test commands, PR process |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting, sandbox model, known security boundaries |

---

## Development

```bash
bun install                    # install all TS deps
cp .env.example .env           # configure — see docs/CONFIGURATION.md
bun test                       # run all TS tests
bun run generate-schemas       # regenerate JSON schemas from types

cd rust/sockt-cli
cargo build                    # build CLI (debug)
cargo build --release          # build CLI (release)
cargo test                     # run CLI test suite
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow.

---

## License

[Functional Source License 1.1 with MIT Future License](LICENSE.md).
Non-competing use is permitted immediately. Converts to MIT automatically 2 years after each release.

---

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
