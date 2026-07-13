# Architecture

This document explains how Sockt's pieces fit together: the six TypeScript
packages, the GBrain memory server, and the Rust CLI. If you're contributing
code, read this first — [CONTRIBUTING.md](../CONTRIBUTING.md) covers dev
workflow, this covers *why the system is shaped the way it is*.

## What Problem This Solves

Multi-agent LLM systems fail in production for three recurring reasons:

1. **Runaway loops** — an agent gets stuck reasoning in circles, burning API
   calls with no bound
2. **Memory loss** — every task starts from zero; agents re-learn the same
   lessons every run
3. **Credential leakage** — API keys and secrets end up in an LLM's context
   window, one prompt injection away from exfiltration

Sockt's answer to each:

1. A **finite state machine** with a hard LLM-call budget per task — hit the
   cap, auto-escalate, never loop
2. An **async memory pipeline** (CADVP → GBrain) that agents read from but
   never write to directly — keeps the hot path fast and injection-resistant
3. **Encrypted secrets at rest** (age/X25519) and **Docker AI Sandbox**
   isolation for code execution — see [SECURITY.md](../SECURITY.md) for the
   current boundary of that protection

## System Overview

```mermaid
flowchart TB
    CLI["sockt CLI (Rust)"] -->|spawns & manages| ORCH
    CLI -->|spawns & manages| GBRAIN
    CLI -->|spawns & manages| CADVP
    CLI -->|spawns & manages| RUNTIME

    subgraph Services
        ORCH["@sockt/orch<br/>Hono HTTP API :3100"]
        GBRAIN["@sockt/gbrain-mcp<br/>Memory server :3200"]
        CADVP["@sockt/cadvp<br/>JSONL tail daemon"]
        RUNTIME["@sockt/runtime<br/>Agent worker process(es)"]
    end

    UI["@sockt/ui<br/>Dashboard :3001"] -->|REST| ORCH

    ORCH -->|SQLite| DB[("sockt.db")]
    RUNTIME -->|claim / complete / escalate| ORCH
    RUNTIME -->|read| GBRAIN
    RUNTIME -->|writes execution log| JSONL[("~/.sockt/scratch/events.jsonl")]
    CADVP -->|tails| JSONL
    CADVP -->|dedup + write| GBRAIN
    GBRAIN -->|git-backed| GBDIR[("./gbrain/")]
```

Everything below `Services` can also be run directly with `bun run
packages/<pkg>/src/serve.ts` for local development — the CLI is a convenience
wrapper that manages process lifecycle, health checks, and encrypted config.

## The TypeScript Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `@sockt/types` | Shared Zod schemas, TS interfaces, error classes | — (root of the dependency graph) |
| `@sockt/fsm` | Task state machine, SQLite store, budget guard | `types` |
| `@sockt/memory` | Vector search, dedup, MCP brain client | `types` |
| `@sockt/orch` | Orchestrator HTTP API, agent registry, department templates | `types`, `fsm`, `slack-gateway` |
| `@sockt/runtime` | Agent execution loop, built-in tools, LLM client | `types` |
| `@sockt/cadvp` | JSONL tail daemon, event dedup, memory ingestion | `types`, `memory` |
| `@sockt/gbrain-mcp` | Local MCP memory server | `types` |
| `@sockt/slack-gateway` | `ChannelGateway` implementation over Slack Socket Mode | `types` |
| `@sockt/ui` | React control-plane dashboard | (calls orch over HTTP, no direct import) |

`types` is the only package every other package depends on. No package
imports another's internals — cross-package communication goes through
`types`-defined interfaces (`TaskStore`, `MemoryStore`, `LlmClient`, `Sandbox`)
or over HTTP (orch's REST API).

## Task Lifecycle (the FSM)

Every unit of work is a `Task`, tracked in SQLite, moving through a strict
state machine:

```mermaid
stateDiagram-v2
    [*] --> pending: task created
    pending --> in_progress: agent claims
    in_progress --> completed: reflect() returns complete
    in_progress --> escalated: budget exhausted OR reflect() escalates
    in_progress --> blocked: HITL gate denies/times out a tool call, OR agent asks a clarifying question
    escalated --> pending: human/architect approves retry
    blocked --> pending: approval granted / question answered
    pending --> cancelled: operator cancels
    in_progress --> cancelled: operator cancels
    completed --> [*]
    cancelled --> [*]
```

Transitions are enforced in `packages/fsm/src/fsm/engine.ts` — an agent
cannot skip states or resurrect a cancelled task. The **budget guard** lives
alongside this: every task has `llmCallsBudget` and `llmCallsUsed`. Each LLM
call increments the counter (`POST /tasks/:id/record-llm-call`); when
`llmCallsUsed >= llmCallsBudget`, the FSM force-transitions the task to
`escalated` — the single most important anti-runaway mechanism in the system.

## Agent Execution Loop

Each `runtime` process polls the orchestrator for pending tasks, claims one,
and runs it through four phases (`packages/runtime/src/runner/`):

```mermaid
flowchart LR
    Plan["Plan<br/>(plan.ts)"] --> Act["Act<br/>(act.ts)"]
    Act --> Observe["Observe<br/>(observe.ts)"]
    Observe -->|more steps| Act
    Observe -->|steps done| Reflect["Reflect<br/>(reflect.ts)"]
    Reflect -->|complete| Done(["completed"])
    Reflect -->|escalate| Esc(["escalated"])
    Reflect -->|neither| Plan
```

- **Plan** — asks the LLM for a numbered list of steps, budget-aware (it's
  told exactly how many steps it can afford given `budgetRemaining`)
- **Act** — executes a step, either via a registered tool
  (`packages/runtime/src/tools/built-in/`) or a direct LLM call
- **Observe** — records the result into the execution trace
- **Reflect** — asks the LLM whether the task is done, needs another loop, or
  should escalate. If `budgetRemaining <= 1`, the runner **skips reflect
  entirely** and force-completes with the last observation — this prevents
  the classic failure mode where reflect says "not done yet," a second
  attempt starts, and it immediately blows the budget on step one.

Every phase writes to an `ExecutionTrace`
(`packages/runtime/src/trace/execution-trace.ts`), which is what CADVP later
reads from the JSONL log.

## Built-in Tools

Registered in `packages/runtime/src/tools/built-in/index.ts`, available to
any agent whose `AgentConfig.tools` list includes them:

| Tool | What it does | Isolation |
|---|---|---|
| `web_search` | Brave Search (if `BRAVE_SEARCH_API_KEY` set) or DuckDuckGo fallback | — |
| `write_file` / `read_file` | I/O against the agent's scratch directory | — |
| `http_request` | Generic HTTP fetch, e.g. for CRM/ticketing APIs | Basic SSRF guard (see [SECURITY.md](../SECURITY.md)) |
| `create_task` | Creates a subtask on the orchestrator with `parentId` set — this is how architect agents delegate | — |
| `exec_code` | Runs Python/JS/TS/Bash | **Docker AI Sandbox** microVM if `sbx` installed+logged in, otherwise unsandboxed temp dir with a warning — or a hard refusal if `EXEC_CODE_REQUIRE_SANDBOX=true` (default for `engops`); gated by `APPROVAL_REQUIRED_TOOLS` for `engops` by default — see [Human-in-the-Loop](#human-in-the-loop-hitl) |
| `ask_user` | Not a real action — short-circuits the run and asks the human a clarifying question instead of guessing. See [Human-in-the-Loop](#human-in-the-loop-hitl) | — |

## Memory Pipeline (CADVP → GBrain)

Agents don't write to memory directly — that would make prompt injection a
direct path to persistent memory poisoning. Instead:

1. Every phase of every task execution appends a line to
   `~/.sockt/scratch/events.jsonl`
2. `@sockt/cadvp` tails that file (`JsonlTailer`), batches new events, and
   deduplicates them against existing memory using cosine similarity
   (default threshold `0.92`)
3. Non-duplicate events are written to `@sockt/gbrain-mcp`, a local SQLite +
   git-backed knowledge store
4. On the next task, the runtime's `SkillCompiler` queries GBrain for
   relevant prior executions and injects them as context

This is also how **skills** work — see [DEPARTMENTS.md](DEPARTMENTS.md) for
the department-specific skill index system, which pre-seeds each department
with `.skill` JSON files (sourced from a curated skills registry) rather than
waiting for the agent to learn them from scratch.

## Orchestrator API

`@sockt/orch` exposes a Hono HTTP server (default port `3100`). Full endpoint
reference: [docs/API.md](API.md). Key groups:

- **Tasks** — create, list, get, patch, claim, complete, escalate, block,
  request-input, cancel, approve, reject, retry, record-llm-call
- **Agents** — register, list, get, deregister (self-registration on
  runtime startup)
- **Approvals** — HITL gate: request, list pending, decide — see
  [Human-in-the-Loop](#human-in-the-loop-hitl)
- **Health** — service status, active agent count, pending task count

The orchestrator has **no built-in authentication** — see
[SECURITY.md](../SECURITY.md#5-the-orchestrator-api-has-no-authentication-by-default)
before exposing it beyond localhost.

## Slack Bridge

`@sockt/types` defines a `ChannelGateway` interface (`onMessage`, `send`,
`listChannels`, `disconnect`) that `Orchestrator` will wire up if you pass
one into its config. `@sockt/slack-gateway` is the implementation, backed
by Slack's Socket Mode API:

```mermaid
sequenceDiagram
    participant Slack
    participant Gateway as SlackChannelGateway
    participant Orch as Orchestrator
    participant Reply as SlackReplyTelemetry

    Slack->>Gateway: message / app_mention event (WebSocket)
    Gateway->>Slack: ack envelope (within 3s)
    Gateway->>Orch: handleMessage(InboundMessage)
    Orch->>Orch: MessageRouter routes to agent, creates Task
    Orch->>Reply: emit task_created (channelId, threadId, platform)
    Note over Reply: correlates taskId -> Slack destination in memory
    Note over Orch: runtime worker claims + executes task normally
    Orch->>Reply: emit task_completed / task_escalated (taskId)
    Reply->>Slack: chat.postMessage (threaded reply)
```

Key points:

- **Inbound** goes over an outbound-only WebSocket (Socket Mode) — no public
  HTTP endpoint or ingress required
- **Outbound** replies use Slack's normal Web API (`chat.postMessage`) —
  Socket Mode is receive-only
- **Inbound events are deduplicated** on `channel:ts` before ever reaching the
  message handler (`SlackChannelGateway`, a capped 500-entry FIFO — see
  `isDuplicateEvent` in `packages/slack-gateway/src/gateway.ts`). A workspace
  subscribed to both `message.channels` and `app_mentions:read` gets two
  separate events — a `message` event and an `app_mention` event — for one
  `@sockt` message, both carrying the same `ts`; without this, that alone
  produced two tasks per human send in ~17/20 rows of the first eval pass
  (see [evals/test-plan.md](../evals/test-plan.md)). Message *edits* creating
  a duplicate task (a separate bug — an edit's event carries a different `ts`
  than the original, so the dedup above doesn't catch it) is handled by a
  second check in `toInboundMessage`: any event carrying a nested
  `message`/`previous_message` field (the shape of a `message_changed`
  envelope) is filtered regardless of its `subtype`. Fixed and live-verified
  2026-07-12 — see test-plan.md's M2 probe and its Phase 3 status update
- The task → Slack-destination correlation is cached in `SlackReplyTelemetry`,
  in memory, keyed by `taskId`, populated from the `task_created` telemetry
  event's `data.channelId`/`data.threadId`/`data.platform` fields (set in
  `Orchestrator.handleMessage`) and consumed on `task_completed`/
  `task_escalated`/`task_blocked`/`task_needs_input`. It's also persisted to
  a `task_origins` SQLite table (`packages/orch/src/store/task-origin-store.ts`)
  at task-creation time — if the in-memory cache misses (e.g. the orchestrator
  restarted mid-task), `SlackReplyTelemetry`'s optional `originLookup` falls
  back to that table, so a restart no longer silently loses the reply. This
  was a confirmed gap in the first eval pass (mechanical probe M3, see
  [evals/test-plan.md](../evals/test-plan.md)) — fixed since
- Enabled automatically by `sockt deploy` once `sockt setup slack` has
  stored encrypted tokens (`~/.sockt/config.yaml`) — see
  [CONFIGURATION.md](CONFIGURATION.md) for the `SLACK_APP_TOKEN`/
  `SLACK_BOT_TOKEN` env vars this resolves to

## Human-in-the-Loop (HITL)

Built directly in response to the first eval pass's biggest finding:
**capability hallucination** — agents confidently claiming to have done
things (sent an email, SSH'd into a box, restarted a service) or answered
underspecified questions ("should we build feature X?") with fabricated
confidence instead of asking. See the "Status update" section at the bottom
of [evals/test-plan.md](../evals/test-plan.md) for the failure rows this
targets (G5, P4, P5, E4, E6, and 4 more).

There are two related but distinct mechanisms, both landing the task in
`blocked` (see the FSM diagram above) until a human acts:

### 1. Tool approval gate

For tools an agent shouldn't be allowed to run unattended (`exec_code` is the
default — see [CONFIGURATION.md](CONFIGURATION.md#runtime-agent-worker)):

```mermaid
sequenceDiagram
    participant Runner as AgentRunner
    participant Gate as HttpHitlGate
    participant Orch as orch (ApprovalStore)
    participant Slack as SlackHitlBridge

    Runner->>Runner: plan step names a tool in APPROVAL_REQUIRED_TOOLS
    Runner->>Gate: requestApproval(...)
    Gate->>Orch: POST /approvals
    Orch->>Slack: onApprovalCreated -> postApprovalRequest
    Slack->>Slack: chat.postMessage with Approve/Deny buttons
    Note over Runner,Gate: waitForApproval polls GET /approvals/:id
    Slack->>Orch: block_actions click -> ApprovalStore.decide()
    Gate-->>Runner: decision {status: approved|denied|timeout}
    Runner->>Runner: anything but "approved" -> TaskOutcome{status:"blocked"}
```

- **`ApprovalStore`** (`packages/orch/src/api/approval-store.ts`) is
  SQLite-backed against the shared `pending_human_inputs` table — survives an
  orch restart, unlike the in-memory `Map` it replaced. A 30s sweep
  (`OrchestratorApi`) marks any approval past its `timeoutAt` as `timeout`,
  belt-and-braces with the poller's own client-side deadline.
- **`HttpHitlGate`** (`packages/runtime/src/hitl/http-hitl-gate.ts`) is the
  `HitlGate` implementation a runtime worker uses — polls
  `GET /approvals/:id` every `HITL_POLL_INTERVAL_MS` until a decision or its
  own `HITL_TIMEOUT_MS` deadline.
- **Fail-closed**: anything other than an explicit `"approved"` — denied,
  timeout, or the approval row simply not existing — blocks the tool call.
  A prior version only checked for `"denied"`, which let a client-side
  timeout fall through and run the gated tool anyway.
- **`SlackHitlBridge`** (`packages/orch/src/hitl/slack-hitl-bridge.ts`) posts
  the Block Kit approve/deny message to the thread that triggered the task
  (looked up via `task_origins`) and routes button clicks back to
  `ApprovalStore.decide()`, then edits the message in place to show the
  decision.

### 2. Clarifying questions (`ask_user`)

For when the task genuinely can't proceed without more information — the
`ask_user` pseudo-tool (`packages/runtime/src/tools/built-in/ask_user.ts`) is
listed in the tool registry purely so plan-phase tool-name grounding accepts
it, but `AgentRunner` intercepts it *before* the Act phase (a human's answer
can't be observed within the same run, so there's nothing to execute):

```mermaid
sequenceDiagram
    participant Runner as AgentRunner
    participant Orch as orch
    participant Slack
    participant Human

    Runner->>Runner: plan step has tool: "ask_user"
    Runner-->>Runner: TaskOutcome{status:"needs_input", question}
    Note over Runner: serve.ts calls orchClient.requestInput(...)
    Orch->>Orch: POST /tasks/:id/request-input<br/>in_progress -> blocked, owner cleared<br/>QuestionStore.create (kind='question')
    Orch->>Slack: task_needs_input telemetry -> reply-telemetry posts the question
    Human->>Slack: replies in the same thread
    Slack->>Orch: handleMessage(InboundMessage)
    Orch->>Orch: QuestionStore.findPendingByThread — matches before normal routing
    Orch->>Orch: answer question, append to task.description,<br/>blocked -> pending, owner cleared
    Note over Orch: task re-enters the claim queue with the answer in its description
```

- **`QuestionStore`** (`packages/orch/src/api/question-store.ts`) is the
  question-shaped sibling of `ApprovalStore`, sharing the same
  `pending_human_inputs` table (`kind='question'`) — it stores the
  originating Slack channel/thread at creation time so a later reply can be
  matched back without a second lookup.
- **Thread-reply interception** happens in `Orchestrator.handleMessage`,
  *before* normal message routing: if the message is a threaded reply and
  `QuestionStore.findPendingByThread` finds a match, it's treated as an
  answer, not a new request — otherwise a reply like "staging, please" would
  itself spawn a new (nonsensical) task.
- The answer is appended to the task's `description` (tasks have no separate
  conversation field) so the next Plan phase reads it as part of the task
  context.

### Real actions behind the approval gate (Phase 4)

`packages/runtime/src/tools/built-in/github_create_issue.ts` is the first
tool with a real, external, hard-to-undo side effect an agent can reach:
`POST /repos/:owner/:repo/issues` against the real GitHub API. It's only
registered — and only ever advertised to the model via `plan.ts`'s tool
listing — when both `GITHUB_TOKEN` and `GITHUB_REPO` are configured
(`BuiltInToolOptions.github`, checked in `registerBuiltInTools`), so the
model never sees a tool name it would immediately fail to use. `product` now
defaults to gating it through `APPROVAL_REQUIRED_TOOLS` (alongside engops'
existing `exec_code` default) in `serve.ts`. To make the gated approval
actually reviewable, `AgentRunner.checkHitlApproval` now appends the plan
step's `args` (capped, JSON-stringified) to the description
`SlackHitlBridge` posts — previously a Slack reviewer only saw the plan's
free-text description ("run the migration script"), not what would actually
execute.

### HITL ergonomics (Phase 5)

Three independent improvements to the approval flow, none touching the core
gate semantics from [Tool approval gate](#1-tool-approval-gate) above:

- **Reminder before timeout.** `ApprovalStore.sweepReminders(leadMs)`
  (`packages/orch/src/api/approval-store.ts`) finds pending approvals whose
  `timeoutAt` is within `HITL_REMINDER_LEAD_MS` (default 2 min) and hasn't
  already been reminded, marks `reminded_at`, and returns them — called
  alongside the existing `sweepTimeouts()` in `OrchestratorApi`'s sweep
  interval. `OrchestratorApiDeps`/`OrchestratorConfig` gained an
  `onApprovalReminder` callback; `orch/src/serve.ts` wires it to
  `SlackHitlBridge.postReminder`, which posts a plain "⏰ Reminder: approval
  for *X* still pending" thread message — not a new approve/deny prompt,
  the original message's buttons are still live.
- **Re-request after timeout.** `sweepTimeouts()`'s existing sweep now also
  fires a new `onApprovalTimeout` callback, wired to
  `SlackHitlBridge.postTimeoutNotice`: it edits the original approval
  message (falling back to a fresh thread post via `taskOriginStore` if the
  in-memory message map missed, e.g. after an orch restart) to show a
  "Re-request approval" button (`action_id: "hitl_rerequest"`, `value:` the
  **taskId**, not the spent approval id). Clicking it calls the bridge's
  `onRerequest` callback — `orch/src/serve.ts` implements this with direct
  `SqliteTaskStore` access, setting the task back to `pending` with `owner`
  cleared (mirroring `/tasks/:id/retry`'s owner-clearing requirement) — so
  the worker re-claims, re-plans, hits the same gated tool again, and a
  fresh approval row + Slack message appears through the normal flow. No new
  approval semantics.
- **Read-only allowlist bypass.** `packages/runtime/src/hitl/readonly-allowlist.ts`'s
  `isReadOnlyExec(toolName, args)` returns true only when `toolName ===
  "exec_code"`, the language is bash/sh, and *every* line (split on `|`,
  `&&`, `;`) matches a read-only command pattern (`git log`, `kubectl get`,
  `grep`, `curl -I`, ...) with no `>`/`>>` redirect or mutation token
  (`rm`/`mv`/`chmod`/`tee`/`sed -i`/...) anywhere, no `$(...)`/backtick/`<(...)`
  command or process substitution (which lets an arbitrary command run
  "inside" what looks like an allowed one — `echo $(reboot)` would otherwise
  match the `echo` pattern), and — `find` specifically — no `-delete`/
  `-exec`/`-execdir`/`-ok`/`-okdir`/`-fprintf` action (find's own built-in
  mutation mechanisms, which don't route through the mutation-token
  blocklist above at all). `AgentRunner`'s HITL check in `runLoop` skips
  `checkHitlApproval` entirely when this returns true, logging a
  `hitl_bypass_readonly` trace step for auditability instead — routing every
  diagnostic `kubectl get pods` through a human approval queue just trains
  people to rubber-stamp without reading. Fail-closed: any
  unmatched line, non-shell language, or unknown tool returns false.
  `HITL_READONLY_BYPASS=false` disables the bypass entirely;
  `ENGOPS_READONLY_EXTRA` appends comma-separated extra regex patterns to
  the built-in allowlist.

## Output Verification Gate

HITL (above) stops an agent from *acting* unsafely. This is the second half:
stopping an agent from *reporting* falsely — the capability-hallucination
problem (a fabricated "email sent") plus a broader class the first eval pass
also found: deliverables missing required structure (no rollback section,
no non-goals), silently exceeding stated limits (a "under 150 words" cold
email that's actually 300), or containing unfilled template artifacts
(`[placeholder]` text nobody replaced). Built 2026-07-12, Phase 2 of the
same production-hardening pass as the task graph section above.

**Not an LLM judge.** Every check here is deterministic — a regex, a word
count, a section-heading scan. This catches only the code-checkable half of
"is this output any good"; see the scope note in
[evals/test-plan.md](../evals/test-plan.md)'s Phase 3.1 status update for
why a real judge is explicitly a separate, harder, not-yet-built piece of
work.

```mermaid
sequenceDiagram
    participant Runner as AgentRunner
    participant Gate as runOutputGate
    participant Plan as planPhase/reflectPhase

    Runner->>Runner: reflect.complete (or budget/attempt exhaustion)
    Runner->>Runner: finalizeCompletion(ctx, proposedOutput, attemptsRemaining)
    Runner->>Gate: runOutputGate({output, artifacts, trace, skill, task, department})
    alt gate passes
        Gate-->>Runner: {pass:true, annotatedOutput}
        Runner-->>Runner: TaskOutcome{status:"completed", output:annotatedOutput}
    else gate fails, attempts remain
        Gate-->>Runner: {pass:false, feedback}
        Runner->>Runner: ctx.gateFeedback.push(feedback); continue attempt loop
        Runner->>Plan: next Plan/Reflect call includes gateFeedback as an explicit message
    else gate fails, no attempts left
        Gate-->>Runner: {pass:false, blockers}
        Runner-->>Runner: TaskOutcome{status:"escalated", reason:"Output failed verification: ..."}
    end
```

- **`runOutputGate`** (`packages/runtime/src/verification/output-gate.ts`) is
  pure — no I/O, same pattern as `hallucination-check.ts`. Always runs one
  built-in regardless of skill: `capabilityClaimWithoutTool` (a refactor of
  the existing `hasUnbackedCapabilityClaim`, split so the gate can test a
  *candidate* output before it becomes the trace's outcome — see
  `packages/runtime/src/skills/hallucination-check.ts`). A fabricated
  "email sent" now fails the gate and never reaches `SlackReplyTelemetry`,
  instead of only being caught after the fact by the offline
  `SKILL_COMPILE_ENABLED` gate on skill compilation.
- **Skill selection** (`AgentRunner.resolveGateSkill`): if
  `task.targetSkill` is set (via `create_task`'s `skill` param — see the
  Task Graph section above), `SkillCompiler.loadByName(name)` loads that
  skill deterministically. Otherwise falls back to
  `ctx.matchedSkills[0]` — the top hit from the `findRelevant()` call
  `runLoop` already made for skill-context injection, now also captured on
  `ExecutionContext` instead of being discarded after use.
- **Checkable rules — `SkillFile.checks`** (`packages/runtime/src/types.ts`):
  an optional array alongside `successCriteria`, added because NLP-parsing
  free-text criteria isn't reliable. Each entry names the `successCriteria`
  string it enforces plus a `type` and type-specific params, e.g.:

  ```json
  { "criterion": "Rollback section is complete and tested", "type": "section_present", "heading": "Rollback", "minChars": 40 }
  ```

  Evaluators for `section_present`, `regex_present`, `regex_absent`,
  `max_words` (whole-output or `per_section`, for multi-variant outreach
  copy), and `count_range` live in
  `packages/runtime/src/verification/checks.ts`. Five more types
  (`lead_provenance`, `computed_number`, `metric_sourcing`,
  `grounded_quotes`, `evidence_citation`) are declared in the `SkillCheck`
  union already — some Phase-2-authored skills reference them ahead of
  time — but have no evaluator yet; `output-gate.ts` routes any check whose
  type isn't in `checks.ts`'s dispatch table to `GateResult.humanReview`
  rather than blocking or crashing, so those checks degrade gracefully
  until their evaluators land in Phase 3.
  `checks` authored so far: `growth/outreach-copy.skill`,
  `product/spec-writing.skill`, `engops/runbook-writer.skill`,
  `engops/incident-responder.skill` — the four skills the first eval pass
  had confirmed, checkable assertions for. Every other bundled skill still
  has `successCriteria` but no `checks` array, so all of it routes to
  human review — the framework catches nothing there yet, it just doesn't
  block anything either.
- **Unmapped criteria policy**: any `successCriteria` entry with no
  matching `checks` entry (by exact string match) also lands in
  `humanReview`, never blocking. When `OUTPUT_GATE_REVIEW_FOOTER` (default
  `true`) is set, `annotatedOutput` appends every warning- and
  human-review criterion as
  `\n\n_Unverified (needs human review): <criterion 1>; <criterion 2>_` so
  the human reading the Slack reply knows what wasn't mechanically
  confirmed.
- **Severity**: each check defaults to `"block"` (fails the gate) but can
  set `"severity": "warn"` to only annotate, never block — used for softer
  signals like a spec's baseline/target metric pattern.
- **Retry feedback plumbing**: `planPhase` trims context to the system
  prompt only by default (`PLAN_CONTEXT_MESSAGES=0`), so a failed gate's
  feedback is threaded through explicitly rather than relying on message
  history — `ExecutionContext.gateFeedback: string[]` (one entry per failed
  attempt), read by both `planPhase` and `reflectPhase`
  (`packages/runtime/src/runner/plan.ts`,
  `packages/runtime/src/runner/reflect.ts`) and injected as its own message
  so the next attempt actually sees why the previous one failed, and
  `reflectPhase` doesn't just immediately re-declare the same output
  complete.
- **`reflectPhase` full-output change**: intermediate step summaries stay
  capped at 120 characters, but the final deliverable (the last `write_file`
  call's content, or the last act step's output if there was no
  `write_file`) is now appended untruncated (up to `REFLECT_OUTPUT_CHARS`,
  default 6000) — otherwise reflect's `"output"` field, and therefore the
  gate's input, was drawn from a 120-char fragment instead of the real
  artifact.
- **Disabling**: `OUTPUT_GATE_ENABLED=false` (resolved in `serve.ts` into
  `AgentRunnerConfig.outputGateEnabled`) skips the gate entirely — every
  completion is accepted as-is. Off by default only if explicitly set;
  the gate runs by default.
- **Join interaction**: a task that's about to block on its `create_task`
  children (see Task Graph below) is checked *before* the output gate runs
  — there's no real "final output" to verify yet when the run is actually
  waiting on subtasks, so `maybeBlockOnChildren` still takes priority.

### Department-specific evaluators (Phase 3)

Five more `SkillCheck` types, all in `packages/runtime/src/verification/checks.ts`,
built once the Phase 2 framework above existed to hang them on:

- **`lead_provenance`** (growth) — parses lead rows out of `[output, ...artifacts]`
  (markdown table rows or numbered-list lines containing an email, a
  `linkedin.com` URL, or a company-suffix token like "Inc"/"LLC"), then
  requires each row's URL to appear in `collectToolEvidence(trace).urls` or
  its email's domain to appear somewhere in the tool-output text — i.e. every
  lead must be traceable to a real `web_search`/`http_request` result, not
  invented. Blocks outright if there's no lead-shaped content at all, or if
  no search tool ran and no URLs were ever seen.
- **`computed_number`** (growth) — for a claim like "K-factor is 0.42", requires
  an `exec_code` call happened in this run *and* that the stated number
  (±0.5% tolerance) actually appears in that call's stdout — catches a model
  stating a plausible-sounding number instead of actually running the
  arithmetic.
- **`metric_sourcing`** (product) — `findUnsourcedMetricClaim` (exported
  separately from the dispatch table) scans `output` sentence-by-sentence for
  metric-shaped claims (`%`, `$`, or a named SaaS metric like MRR/CAC/NPS
  followed by a number), and passes each one only if it's prefixed/neighbored
  by `ASSUMPTION`/`assumed`/`estimate`, or its number is backed by
  `collectToolEvidence(trace).numbers`, or the number already appears in
  `task.description` (user-supplied). This one is also an **always-on
  built-in**: `runOutputGate` calls it unconditionally for
  `department === "product"` regardless of which skill (if any) applies —
  see the department-independent built-ins call site in
  `verification/output-gate.ts`, right alongside the capability-claim check.
- **`grounded_quotes`** (product) — extracts verbatim quoted/bulleted spans
  from `task.description` (the actual user research input) and requires at
  least `minQuotes` of them to reappear in the output as a ≥6-consecutive-word
  overlap — a synthesis that doesn't quote the real input is generic prose,
  not research. When the input itself contained no verbatim feedback to
  ground against, this check **downgrades to a warning** rather than blocking
  on an impossible bar — the one case in this framework where an evaluator
  overrides its own check's declared severity (via `GateFailure.severity`,
  which `output-gate.ts` prefers over `check.severity` when both are set).
- **`evidence_citation`** (engops) — finds sentences matching a causal-claim
  pattern (e.g. "root cause", "caused by"), tokenizes them to content words
  (≥4 chars, stopwords dropped), and requires enough of those tokens
  (`minOverlapTokens`, default 4) to appear in `task.description` +
  `collectToolEvidence(trace).text` — the deterministic-heuristic version of
  "don't invent log lines or config changes that were never in the input or
  any tool result."

`checks[]` authoring is now complete for all 17 bundled skills — the six left
over from Phase 2 (`lead-generation`, `growth-metrics`, `product-manager`,
`user-research`, `github-issues`, `devops-troubleshooter`) got real checks
using the evaluators above; the remaining seven
(`email-sequence`, `churn-prevention`, `seo-content-audit`,
`social-hook-writing`, `pricing-strategy`, `onboarding-activation`,
`deployment-engineer`) got `human_review` entries for every criterion — the
framework picks them up for free whenever a future evaluator covers them,
without needing another authoring pass.

### Growth preflight (Phase 3, §4.2)

`packages/runtime/src/runner/preflight.ts`'s `preflightCheck` runs at the very
top of `AgentRunner.runLoop`, before skill injection or any LLM call: if the
agent is in `growth` and the task looks like lead generation (explicit
`targetSkill: "lead-generation"`, or the description matches a
lead/prospect/contact-list pattern) and neither `TAVILY_API_KEY` nor
`BRAVE_SEARCH_API_KEY` is configured, it short-circuits straight to
`needs_input` — "no search API key configured, configure one or ask me to
produce a search plan instead" — riding the exact same `needs_input` →
`QuestionStore` → threaded-reply-resume flow `ask_user` already uses, zero new
machinery. This stops the model from ever reaching the point of inventing
plausible-looking contacts (which `lead_provenance` above would only catch
*after* generation). `GROWTH_REQUIRE_SEARCH_API=false` disables it.

## Task Graph: Targeting, Ordering, and Joins

`create_task` (`packages/runtime/src/tools/built-in/create_task.ts`) is how an
architect delegates work — it's also where the first eval pass's biggest
production defect lived: a subtask created without explicit targeting was
claimable by *any* worker in *any* department, so it could run under the
wrong system prompt entirely. Three mechanisms close that and two related
gaps, all added 2026-07-12:

- **Department/role targeting** — `create_task` accepts an optional
  `department` param; if omitted, it now defaults to the *caller's own*
  `department` (previously it defaulted to nothing, i.e. any department could
  claim it). An explicit override is validated against
  `VALID_DEPARTMENTS = {"growth", "product", "engops", "general"}` and thrown
  on anything else, rather than silently creating an untagged task. The
  matching claim-side fix is in `packages/runtime/src/serve.ts`'s `claimable`
  filter, which now checks `task.targetDepartment` against the worker's own
  `department` (previously it only checked `targetRole`).
- **Skill targeting** — an optional `skill` param is stored as
  `Task.targetSkill` and surfaced to the worker via
  `packages/runtime/src/runner/context.ts`'s `buildSystemPrompt()`, which
  appends `Required skill: <skill> — follow that skill's workflow exactly.`
  when set.
- **Ordering (`after`)** — an optional `after` param (validated against the
  `taskId`s the *current* execution actually created, tracked in a
  caller-owned `createdIdsByParent: Map<string, Set<string>>` passed through
  `serve.ts` — an `after` pointing at any other id, including a real task id
  from a different parent, throws) is stored as `Task.afterId`. This is a
  pure query-filter mechanism, not a new FSM state:
  `SqliteTaskStore.listPending()` (`packages/fsm/src/store/sqlite-task-store.ts`)
  excludes a task whose `afterId` dependency hasn't reached `completed` yet.
  If the dependency instead lands on `escalated` or `cancelled`, the
  dependent can never become claimable — a periodic sweep in
  `OrchestratorApi`'s `sweepInterval` (`packages/orch/src/api/server.ts`)
  calls `listPendingWithDeadDependency()` and auto-cancels those orphaned
  tasks with an explanatory `output`, rather than leaving them pending
  forever.
- **Parent-child join** — before this, a decomposing architect task could
  itself reach a terminal state (complete/escalate) while its
  `create_task`-spawned children were still running, with no aggregation of
  their results at all. Now, `AgentRunner.maybeBlockOnChildren`
  (`packages/runtime/src/runner/agent-runner.ts`) checks whether the current
  execution called `create_task` at least once; if so, the task's outcome is
  overridden to `blocked` with `dependency: "awaiting-children:<id1>,<id2>,..."`
  instead of completing. `maybeResumeParent`
  (`packages/orch/src/join/parent-join.ts`) is called after every
  child-terminal transition (`/complete`, `/escalate`, `/cancel`, and the
  budget-exhaustion branches of `/record-llm-call` and `/llm-call`, all in
  `packages/orch/src/api/routes/tasks.ts`); once *all* siblings under a
  `blocked`-on-`awaiting-children:` parent are terminal, it computes a new
  description (each child's status and output appended, prefixed with a
  `[join] All subtasks finished.` marker and a `Synthesize ONE final answer`
  instruction) and resumes the parent via `SqliteTaskStore.resumeIfBlocked` —
  a single atomic `UPDATE ... WHERE status = 'blocked'` that sets
  `status='pending'`, `owner=NULL`, and the new description all in one
  statement, rather than a separate read-transition-write sequence. This
  matters when two children finish close together: both calls can read the
  parent as still `blocked`, but only one's `resumeIfBlocked` actually
  matches a row — the other affects zero rows instead of overwriting the
  winner's already-joined description with a second synthesis block.
  `AgentRunner` checks for the `JOIN_MARKER` on task pickup so a resumed join
  completes normally instead of re-blocking on its own already-finished
  children.
  `packages/slack-gateway/src/reply-telemetry.ts` special-cases the
  `awaiting-children:` dependency string to post a friendlier
  "⏳ Delegated to N subtask(s)…" message instead of the generic blocked-task
  wording.
  > Note: `AWAITING_CHILDREN_PREFIX`/`JOIN_MARKER` are intentionally
  > duplicated as literal string constants in both `agent-runner.ts` (runtime)
  > and `parent-join.ts` (orch) rather than imported — `runtime` has no
  > package dependency on `orch` (they only talk over HTTP), the same reason
  > HITL status strings already cross that boundary as literals.

All three architect prompts in
`packages/runtime/src/prompts/department-prompts.ts` were updated with
department-specific examples of when to pass `skill:`/`after:` on
`create_task` calls.

## Departments & Multi-Agent Coordination

A **department** (`growth`, `product`, `engops`) is a template:
`packages/orch/src/registry/templates/<name>.ts` returns an array of
`AgentConfig`s — one **architect** (decomposes goals into subtasks via
`create_task`) and one or more **workers** (claim and execute leaf tasks).
Full detail in [DEPARTMENTS.md](DEPARTMENTS.md).

`sockt department add <name>` activates a template; `sockt deploy` spawns
one `runtime` process per configured agent, each polling the orchestrator
independently.

## The Rust CLI

`rust/sockt-cli` is the operator-facing binary. It does not contain business
logic — it's a process manager and thin HTTP client:

- `deploy` / `stop` / `restart` / `destroy` — spawn/manage the Bun processes
  above (or `sbx run` them for sandboxed agents), track PIDs in
  `~/.sockt/runtime.json`
- `status` / `health` / `doctor` — poll the orchestrator's `/health` and
  inspect local process state
- `tasks` / `ask` / `brain` / `department` — thin wrappers around the
  orchestrator's REST API (`src/orch_client.rs`)
- `config` / `secrets` / `setup` — manage `~/.sockt/config.yaml`, encrypted
  with `age`

See [CONTRIBUTING.md](../CONTRIBUTING.md#repository-layout) for where each
command's implementation lives.

## Where the OSS/Paid Boundary Sits

Everything in this repository is licensed under
[FSL-1.1-MIT](../LICENSE.md) — free for non-competing use, converts to MIT
automatically two years after each release. The hosted Sockt platform adds,
on top of this OSS core:

- **GBrain cloud sync** — the local `gbrain-mcp` server here is fully
  functional standalone; the paid tier adds team-shared, multi-device sync
- **TEE credential vaults** — hardware-isolated secret storage beyond the
  local `age`-encrypted file used here
- **Fleet intelligence / cross-deployment analytics** — aggregated
  benchmarking across the hosted customer base

Nothing in this repo phones home or requires the paid tier to function.
