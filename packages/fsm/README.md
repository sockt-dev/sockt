# @sockt/fsm

The task state machine at the core of Sockt's anti-runaway design. A SQLite-backed `TaskStore` implementation, a strict finite state machine that enforces valid task transitions, an LLM-call budget guard, and an atomic claim lock for concurrent agent workers.

This is the single most important package for the "agents won't bankrupt you" guarantee — every LLM call an agent makes is metered here, and a task cannot silently loop past its budget.

## Install

```bash
bun add @sockt/fsm
```

Requires `bun:sqlite` (Bun runtime) — this package is not Node-compatible.

## What's in here

### `SqliteTaskStore`

Implements the `TaskStore` interface from `@sockt/types` against a SQLite database. Handles create, get, update, delete, and status-filtered listing for tasks. Call `initializeSchema(db)` once against your database before using it.

### `FsmEngine`

Validates and executes state transitions. Every transition is checked against the table below before it's applied — invalid transitions throw rather than silently succeeding.

```
pending ──────────────► in_progress ──────► completed
   │                        │
   │                        ├──────► escalated ──► pending | cancelled
   │                        │
   │                        ├──────► blocked ────► pending | cancelled
   │                        │
   │                        └──────► cancelled
   │
   └──────────────────────────────► cancelled
```

`completed` and `cancelled` are terminal — no transitions out.

### `TaskClaimLock`

Atomic claim mechanism so two agent workers can poll the same pending-task queue without double-claiming. Backed by a SQLite transaction, not an in-memory mutex — safe across multiple worker processes.

### Budget guard

Every task carries `llmCallsBudget` and `llmCallsUsed`. Each LLM call increments the counter; when the budget is exhausted the task is force-transitioned to `escalated` rather than continuing — this is what actually stops an agent loop, independent of whether the agent itself "decides" to stop.

## Usage

```typescript
import { Database } from "bun:sqlite";
import { SqliteTaskStore, FsmEngine, TaskClaimLock, initializeSchema } from "@sockt/fsm";

const db = new Database("./sockt.db");
initializeSchema(db);

const store = new SqliteTaskStore(db);
const fsm = new FsmEngine(store);
const claimLock = new TaskClaimLock(db);

const task = await store.create({ tenantId: "acme", description: "...", llmCallsBudget: 25 });
const claimed = await claimLock.claim(task.id, "agent-1");
await fsm.transition(claimed.id, "in_progress", "completed", "agent-1");
```

## Testing

`createTestDb()` spins up an in-memory SQLite database with the schema already applied — use it in package tests instead of hitting disk.

```typescript
import { createTestDb } from "@sockt/fsm";

const db = createTestDb();
```

## Docs

Task lifecycle and the full state diagram: [docs/ARCHITECTURE.md#task-lifecycle-the-fsm](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md#task-lifecycle-the-fsm)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
