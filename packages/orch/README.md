# @sockt/orch

The orchestrator — a Hono HTTP server, agent registry, department template manager, cron scheduler, and message router. This is the central coordination point every `@sockt/runtime` worker, the `sockt` CLI, and the UI dashboard talk to over HTTP.

## Install

```bash
bun add @sockt/orch
```

## What's in here

### `Orchestrator`

The top-level class. Wraps a `SqliteTaskStore` + `FsmEngine` (from `@sockt/fsm`), an `AgentRegistry`, a `Scheduler`, and the HTTP API into one thing you construct and `.start()`.

```typescript
import { Orchestrator } from "@sockt/orch";
import { Database } from "bun:sqlite";

const orch = new Orchestrator({
  port: 3100,
  dbPath: "./sockt.db",
  agents: [],
});

await orch.start();
```

### `OrchestratorApi`

The Hono app itself, if you want to mount it inside a larger server rather than let `Orchestrator` own the HTTP listener. Exposes routes for tasks (create/list/get/patch/claim/complete/escalate/cancel/approve/reject/retry/record-llm-call), agents (register/list/get/deregister), approvals (create/list-pending/decide), and health.

### `AgentRegistry`

In-memory registry of `AgentConfig`s. Agents self-register on startup via `POST /agents/register`; the registry is what `MessageRouter` and department templates read from.

### `DepartmentManager`

Instantiates a department template (`growth`, `product`, `engops`, ...) — an architect agent plus one or more worker agents — against a tenant.

### `MessageRouter`

Routes inbound messages (from a `ChannelGateway`, e.g. Slack) to the right agent based on registered routing rules.

### `Scheduler`

Cron-based task scheduling via `node-cron` — register a `ScheduleConfig` to have the orchestrator create tasks on a recurring schedule.

### `LockManager`

Tracks which agent currently holds which task lock, independent of the SQLite-level `TaskClaimLock` in `@sockt/fsm` — this is what backs the `activeAgents` count on `GET /health`.

## Usage

```typescript
import { Orchestrator } from "@sockt/orch";

const orch = new Orchestrator({
  port: Number(process.env.PORT) || 3100,
  dbPath: process.env.DB_PATH || "./sockt.db",
  agents: [],
});

await orch.start();
console.log(`orchestrator listening on ${orch.getPort()}`);
```

Agents (via `@sockt/runtime`) then poll `GET /tasks?tenantId=...&status=pending`, claim with `POST /tasks/:id/claim`, and report back with `complete`/`escalate`.

## API reference

Full HTTP API — every route, request/response shape, and error format: [docs/API.md](https://github.com/sockt-dev/sockt/blob/main/docs/API.md)

**No authentication is built in.** Don't expose this beyond localhost without a reverse proxy — see [SECURITY.md](https://github.com/sockt-dev/sockt/blob/main/SECURITY.md).

## Docs

Architecture and how orch fits with the rest of the system: [docs/ARCHITECTURE.md](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md)

Departments and the skill index pattern: [docs/DEPARTMENTS.md](https://github.com/sockt-dev/sockt/blob/main/docs/DEPARTMENTS.md)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
