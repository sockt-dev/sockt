# Orchestrator API Reference

The orchestrator (`@sockt/orch`) exposes a Hono HTTP server, default port
`3100`. This is what the `runtime` workers, the `sockt` CLI, and the `ui`
dashboard all talk to.

**No authentication is built in.** See
[SECURITY.md](../SECURITY.md#5-the-orchestrator-api-has-no-authentication-by-default)
before exposing this beyond localhost.

All request/response bodies are JSON. Base URL in examples: `http://localhost:3100`.

---

## Tasks

### `POST /tasks`

Create a task.

```jsonc
// Request
{
  "tenantId": "default",
  "description": "Summarise our top 3 competitors",
  "parentId": null,           // optional — set to create a subtask
  "role": "architect",        // optional — used for creation validation, default "architect"
  "llmCallsBudget": 15,       // optional, default 25
  "maxAttempts": 3            // optional, default 3
}
```

```jsonc
// Response 201
{
  "id": "019f2974-3db8-74fd-addf-46f8307477f9",
  "tenantId": "default",
  "status": "pending",
  "owner": null,
  "parentId": null,
  "description": "Summarise our top 3 competitors",
  "output": null,
  "llmCallsUsed": 0,
  "llmCallsBudget": 15,
  "attemptCount": 0,
  "maxAttempts": 3,
  "createdAt": "2026-07-03T19:28:31.672Z",
  "updatedAt": "2026-07-03T19:28:31.672Z"
}
```

`403` if `fsm.validateCreation` rejects it (e.g. invalid parent/role combination).

### `GET /tasks`

List all tasks for a tenant.

**Query params:** `tenantId` (required), `status` (optional — filter to one FSM state)

```
GET /tasks?tenantId=default&status=escalated
```

Returns `Task[]`. `400` if `tenantId` is missing.

### `GET /tasks/pending`

List only `pending` tasks for a tenant — this is what `runtime` workers poll.

**Query params:** `tenantId` (required)

Returns `Task[]`. `400` if `tenantId` is missing.

> Note: this route is registered before `GET /tasks/:id` in the router so
> that `/tasks/pending` doesn't get swallowed as an `:id` lookup — if you're
> adding new static routes under `/tasks/*`, add them above the `:id` routes.

### `GET /tasks/:id`

Get a single task. `404` if not found.

### `PATCH /tasks/:id`

Update a task's `status` and/or `output` directly. Used by the CLI/UI for
manual overrides (e.g. force-cancel).

```jsonc
// Request (both fields optional)
{ "status": "cancelled", "output": "manually stopped" }
```

`404` if the task doesn't exist.

---

## Task Lifecycle Actions

These correspond to FSM transitions — see
[ARCHITECTURE.md](ARCHITECTURE.md#task-lifecycle-the-fsm) for the full state
diagram.

### `POST /tasks/claim`

Legacy claim route — `taskId` and `agentId` both in the body.

```jsonc
{ "taskId": "...", "agentId": "..." }
```

### `POST /tasks/:id/claim`

Preferred claim route (used by `@sockt/runtime`'s `HttpOrchClient`) — `taskId`
in the URL, `agentId` in the body.

```jsonc
{ "agentId": "growth-worker-5452" }
```

Both claim routes: `409` if the task is already claimed or not `pending`.
Transitions `pending → in_progress`.

### `POST /tasks/:id/complete`

```jsonc
{ "output": "...", "agentId": "growth-worker-5452" }
```

Transitions `in_progress → completed`. `400` if task isn't `in_progress`.

### `POST /tasks/:id/escalate`

```jsonc
{ "reason": "LLM call budget exceeded", "agentId": "..." }
```

Transitions `in_progress → escalated`. `400` if task isn't `in_progress`.

### `POST /tasks/:id/block`

```jsonc
{ "dependency": "HITL denied: exec_code", "agentId": "..." }
```

Transitions `in_progress → blocked` and releases the claim lock. `400` if
task isn't `in_progress`. Not terminal — `blocked → pending` is a legal
transition (via `/retry` or `/approve`, both of which also clear `owner` so
the task can actually be re-claimed). See
[ARCHITECTURE.md#human-in-the-loop-hitl](ARCHITECTURE.md#human-in-the-loop-hitl).

### `POST /tasks/:id/request-input`

```jsonc
{ "question": "Which environment should I deploy to?", "agentId": "..." }
```

Like `/block`, but also records the question (`QuestionStore`, shares the
`pending_human_inputs` table with approvals) so a later threaded Slack reply
can be matched back to it and treated as an answer rather than a new
request — see [ARCHITECTURE.md#2-clarifying-questions-ask_user](ARCHITECTURE.md#2-clarifying-questions-ask_user).
Transitions `in_progress → blocked`. `400` if task isn't `in_progress`.

### `POST /tasks/:id/cancel`

No body required. Sets status to `cancelled` from any active state. `404` if
task doesn't exist.

### `POST /tasks/:id/retry`

No body required. Sets status back to `pending` — used to re-queue
failed/escalated tasks. `404` if task doesn't exist.

### `POST /tasks/:id/approve`

HITL approval — sets status back to `pending` so a worker picks it up again.
`404` if task doesn't exist.

### `POST /tasks/:id/reject`

```jsonc
{ "reason": "..." }   // optional
```

HITL rejection — sets status to `cancelled`, stores the reason in `output`.
`404` if task doesn't exist.

---

## Budget Tracking

### `POST /tasks/:id/record-llm-call`

Preferred route (used by `@sockt/runtime`). Increments `llmCallsUsed`; if the
budget is now exhausted, auto-transitions the task to `escalated`.

```jsonc
// Response
{ "allowed": true, "remaining": 4 }
```

### `POST /tasks/:id/llm-call`

Legacy alias. Same behavior, response shape is `{ remaining: number }` (no
`allowed` field) — prefer `record-llm-call` for new integrations.

---

## Agents

### `GET /agents`

**Query params:** `tenantId` (optional — omit to list all agents across
tenants)

Returns `AgentConfig[]`.

### `GET /agents/:id`

Get a single agent config. `404` if not found.

### `POST /agents/register`

Registers or re-registers an agent. This is called automatically by
`@sockt/runtime` on process startup (with retry — it doesn't fail hard if
orch isn't up yet).

```jsonc
{
  "id": "growth-worker-5452",       // optional — server generates a UUID if omitted
  "tenantId": "default",
  "name": "growth worker",
  "role": "worker",                 // "worker" | "architect"
  "llmConfig": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
  "systemPrompt": "...",
  "tools": ["web_search", "write_file"],
  "department": "growth",
  "maxConcurrentTasks": 1
}
```

Returns the registered `AgentConfig`, `201`.

### `DELETE /agents/:id`

Deregister an agent. `404` if not found, else `{ "ok": true }`.

---

## Approvals (HITL)

Backed by SQLite (`ApprovalStore`, shares the `pending_human_inputs` table
with clarifying questions) — approvals survive an orchestrator restart. A
30-second sweep marks any approval past its `timeoutAt` as `status: "timeout"`.
If a `SLACK_APP_TOKEN`/`SLACK_BOT_TOKEN` pair is configured, creating an
approval also posts a Block Kit approve/deny message to the thread that
triggered the task (`SlackHitlBridge`) — see
[ARCHITECTURE.md#1-tool-approval-gate](ARCHITECTURE.md#1-tool-approval-gate).

### `GET /approvals/pending`

**Query params:** `tenantId` (required — `400` if missing)

Returns all approvals with `status: "pending"` for that tenant.

### `POST /approvals`

Create an approval request (typically called by the runtime's HITL gate when
a tool requires approval).

```jsonc
{
  "tenantId": "default",
  "agentId": "engops-deploy-worker",
  "taskId": "...",
  "tier": "confirm",
  "action": "exec_code",
  "description": "Run deployment rollback script",
  "context": { }   // optional, arbitrary object
}
```

Returns the created approval, `201`.

### `GET /approvals/:id`

Get one approval by ID. `404` if not found.

### `POST /approvals/:id/decide`

```jsonc
{
  "status": "approved",   // "pending" | "approved" | "denied" | "timeout"
  "decidedBy": "operator@example.com",  // optional — the Slack button flow passes the clicking user's id
  "reason": "..."                        // optional
}
```

Returns the current approval either way — `404` only if the id doesn't exist
at all. If the approval was already decided (including by the 30s timeout
sweep), returns its existing state rather than overwriting it.

---

## Health

### `GET /health`

```jsonc
{
  "status": "healthy",
  "uptime": 33218,
  "activeAgents": 1,
  "pendingTasks": 0
}
```

`uptime` is milliseconds since the orchestrator process started. `activeAgents`
counts agents currently holding at least one task lock — it does not count
registered-but-idle agents (use `GET /agents` for the full registry).

`pendingTasks` is currently hardcoded to `0` in this route — use `GET
/tasks?status=pending` for an accurate count. (Tracked as a known gap.)

---

## Error Shape

Errors are returned as:

```jsonc
{ "error": "human-readable message" }
```

with an appropriate HTTP status (`400` bad request, `403` forbidden by FSM
rules, `404` not found, `409` conflict on claim races).
