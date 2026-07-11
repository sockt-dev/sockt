# Configuration Reference

All configuration is via environment variables. Bun auto-loads `.env` from the
repo root — no `dotenv` package needed. Copy [`.env.example`](../.env.example)
to `.env` and fill in your values to get started.

The Rust CLI (`sockt`) stores its own config separately at `~/.sockt/config.yaml`
(see [CLI config](#cli-config-sockt-configyaml) below) and injects most of these
variables automatically when it spawns services via `sockt deploy`.

---

## LLM Provider

| Variable | Default | Read by | Description |
|---|---|---|---|
| `MODEL_PROVIDER` | `anthropic` | runtime | `anthropic` \| `openai` \| `groq` \| `google` \| `ollama` |
| `MODEL_API_KEY` | — | runtime | API key for the selected provider |
| `FRONTIER_MODEL` | `claude-sonnet-4-6-20250514` | runtime | Model used for planning/reflection (the "smart" model) |
| `FAST_MODEL` | `claude-haiku-4-5-20251001` | runtime | Reserved for cheaper/faster calls (not yet wired into runtime — see [#issues](https://github.com/sockt-dev/sockt/issues)) |
| `MODEL_BASE_URL` | — | runtime | Only needed for self-hosted / OpenAI-compatible endpoints (Ollama, LM Studio, OpenRouter) |

**Google** is not yet supported (`getProvider()` throws `LlmError`) — tracked for a future release.

---

## Orchestrator

| Variable | Default | Read by | Description |
|---|---|---|---|
| `ORCH_URL` | `http://localhost:3100` | runtime, CLI | Where the orchestrator's Hono API is reachable |
| `DEPLOYMENT_ID` | `default` | orch, runtime | Tenant ID — all tasks/agents are scoped to this |
| `PORT` | `3100` (orch) / `3001` (ui) | orch, ui | HTTP port to bind |
| `DB_PATH` | `./sockt.db` | orch | SQLite file path for the task store |
| `SLACK_APP_TOKEN` | — | orch | Slack app-level token (`xapp-...`). Set both this and `SLACK_BOT_TOKEN` to enable the Slack bridge (`@sockt/slack-gateway`) — orch opens a Socket Mode connection on startup. See [ARCHITECTURE.md#slack-bridge](ARCHITECTURE.md#slack-bridge) |
| `SLACK_BOT_TOKEN` | — | orch | Slack bot token (`xoxb-...`), used for `chat.postMessage`/`conversations.list` |

`sockt deploy` sets both automatically once `sockt setup slack` has stored encrypted tokens — you don't need to set these by hand if you're using the CLI-managed workflow. They're only for running `orch/src/serve.ts` directly during development.

---

## Runtime (agent worker)

| Variable | Default | Read by | Description |
|---|---|---|---|
| `DEPARTMENT` | `general` | runtime | Which department this worker belongs to — also resolves `SKILLS_DIR` |
| `AGENT_ROLE` | `worker` | runtime | `worker` \| `architect` |
| `MAX_CONCURRENT` | `1` | runtime | Max tasks this worker process claims and runs at once |
| `MAX_TOKENS` | `4096` | runtime | Max tokens per LLM response. Lower this (e.g. `512`) on rate-limited free tiers |
| `LLM_CALL_DELAY_MS` | `0` | runtime | Forced delay between LLM calls. Set to `3000` on Groq's free tier to avoid 429s |
| `PLAN_CONTEXT_MESSAGES` | `0` | runtime | How many prior messages to include in the plan phase. `0` = system prompt only (token-efficient default) |
| `SKILLS_DIR` | auto-resolved from `DEPARTMENT` | runtime | Path to `.skill` JSON files this agent can draw on. See [DEPARTMENTS.md](DEPARTMENTS.md) |
| `APPROVAL_REQUIRED_TOOLS` | `exec_code` if `DEPARTMENT=engops`, else unset (no gate) | runtime | Comma-separated tool names that require human approval before running. Set explicitly (including `""` to force no gate) to override the department default — e.g. gate other tools/departments, or un-gate engops. See [ARCHITECTURE.md#human-in-the-loop-hitl](ARCHITECTURE.md#human-in-the-loop-hitl) |
| `HITL_TIMEOUT_MS` | `300000` (5 min) | runtime | How long `AgentRunner` waits for an approval decision before treating it as a timeout (fail-closed — the gated tool does not run) |
| `HITL_POLL_INTERVAL_MS` | `2000` | runtime | How often `HttpHitlGate` polls orch for a decision while waiting |

### Tuning for rate-limited free-tier LLMs (e.g. Groq)

Groq's free tier caps out around 6,000 tokens/minute. If you see tasks
escalate with `Rate limit reached ... tokens per minute (TPM)`, set:

```bash
LLM_CALL_DELAY_MS=3000
MAX_TOKENS=512
```

This throttles calls and shrinks responses so a multi-step task loop stays
under the TPM ceiling. Paid-tier keys (Anthropic, OpenAI) don't need this —
leave both unset (defaults `0` / `4096`).

---

## GBrain / CADVP (memory pipeline)

| Variable | Default | Read by | Description |
|---|---|---|---|
| `GBRAIN_URL` | `http://localhost:3200` | cadvp, runtime | GBrain MCP server address |
| `GBRAIN_DIR` | `./gbrain` | orch, gbrain-mcp | Local GBrain knowledge directory (git-backed) |
| `WATCH_DIR` | `~/.sockt/scratch` | cadvp | Directory CADVP tails for `events.jsonl` |
| `CHECKPOINT_PATH` | `~/.sockt/scratch/cadvp-checkpoint.json` | cadvp | Resume point after daemon restarts |

---

## Optional integrations

| Variable | Default | Read by | Description |
|---|---|---|---|
| `BRAVE_SEARCH_API_KEY` | — | runtime (`web_search` tool) | If unset, `web_search` falls back to DuckDuckGo instant answers (no key required, lower quality results) |

---

## CLI config (`sockt` / `~/.sockt/config.yaml`)

The Rust CLI persists its own configuration outside of `.env`, created by
`sockt init` and edited via `sockt config get/set`:

```bash
sockt config show              # view current config
sockt config get models.provider
sockt config set models.frontier claude-opus-4-8
```

Secrets (API keys, integration tokens) are encrypted at rest with `age`
(X25519) and stored under `~/.sockt/key.txt` + inside `config.yaml`. Manage
them with:

```bash
sockt secrets list
sockt secrets set <name> <value>
sockt secrets rotate
```

When you run `sockt deploy`, the CLI decrypts these values and injects them
as the environment variables listed above into each spawned process — you
generally don't need to hand-edit `.env` if you're using the CLI-managed
workflow. `.env` is primarily for running individual packages directly during
development (`bun run packages/orch/src/serve.ts`, etc.).

---

## Precedence

1. Actual process environment (`FOO=bar bun run ...`)
2. `.env` in repo root (Bun auto-load)
3. Hardcoded defaults in each `serve.ts` / `start.ts`

CLI-spawned processes (`sockt deploy`) set env vars explicitly per-process —
they do not read `.env`.
