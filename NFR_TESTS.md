# NFR Tests — Sockt CLI & System

Non-functional requirements test log. Each feature was exercised manually against a live local stack.

**Environment:** Windows 11, Bun 1.3.14, Rust 1.x (stable), cargo build (debug)
**Date:** 2026-07-03
**Branch:** main

---

## Test Setup

```bash
# Install Rust toolchain
winget install Rustlang.Rustup
rustup default stable

# Build CLI
cd rust/sockt-cli
cargo build

# Init a test deployment
cargo run -- init --non-interactive \
  --provider anthropic \
  --api-key "sk-ant-..." \
  --frontier "claude-sonnet-4-6" \
  --fast "claude-haiku-4-5-20251001" \
  --skip-verify \
  --dir "C:\tmp\sockt-test"

# Start orchestrator (port 3100)
PORT=3100 bun run packages/orch/src/serve.ts
```

---

## Results

### 1. Binary + Help

```bash
sockt --help
```

**Status: PASS**

All 19 commands listed with descriptions. Version flag works. `--config` and `--verbose` global flags present.

---

### 2. Doctor

```bash
sockt doctor
```

**Status: PASS**

Correct exit codes:
- Exit 0 — all checks pass (ready to deploy)
- Exit 1 — warnings only (3 warnings: no config, no key, no GBrain → `sockt init`)
- Exit 2 — errors (Bun not in PATH → install required)

Checks verified:
- Bun version detection (`v1.3.14`)
- Git version detection
- Disk space (Windows: returns "not available on this platform" — expected)
- Config file missing detection
- Encryption key missing detection
- GBrain git repo detection

---

### 3. Init (non-interactive)

```bash
sockt init --non-interactive --provider anthropic --api-key sk-ant-... \
  --frontier claude-sonnet-4-6 --fast claude-haiku-4-5-20251001 \
  --skip-verify --dir /tmp/sockt-test
```

**Status: PASS**

Produces:
- `~/.sockt/config.yaml` with encrypted API key
- `~/.sockt/key.txt` (age X25519 identity)
- GBrain directory with `SOUL.md`, `AGENTS.md`, `skills/example.md`
- `docker-compose.yaml`
- Correct next-steps output

Bug found: `--frontier` required in `--non-interactive` mode but not documented in `--help`. Minor UX issue.

---

### 4. Config Show

```bash
sockt config show
```

**Status: PASS**

Displays formatted config with:
- Encrypted fields masked as `••••••••  (encrypted)`
- Tier, deployment ID, provider, models, Slack placeholders, GBrain path
- Config file path shown in header

---

### 5. Config Get/Set

```bash
sockt config get models.provider   # → "anthropic"
sockt config set deployment_id foo # → Error: read-only
sockt config get deployment_id     # → original UUID unchanged
```

**Status: PASS**

Dot-path access works correctly. Read-only keys correctly blocked with informative error.

---

### 6. Secrets List / Set

```bash
sockt secrets list
sockt secrets set github_token ghp_test123
```

**Status: PASS**

`list` shows 4 named secret slots with encryption status and key fingerprint.

`set github_token` correctly blocked until `sockt setup integration github` is run first — enforces integration pre-requisite ordering.

---

### 7. Setup LLM

```bash
sockt setup llm --non-interactive --provider openai \
  --api-key sk-... --frontier gpt-4o --fast gpt-4o-mini --skip-verify
```

**Status: PASS**

Reconfigures provider and models, re-encrypts API key, persists to config. Verified with `sockt config get models.provider` → `openai`.

---

### 8. Brain Summary + Search + Skills

```bash
sockt brain
sockt brain search "agent"
sockt brain skills list
```

**Status: PASS** (after fix)

`sockt brain` and `sockt brain skills list` passed immediately.

**Bug found:** `sockt brain search` called system `grep` binary which does not exist on Windows.

**Fix:** Replaced system `grep` call with native Rust file walker (`std::fs::read_dir` recursive) with case-insensitive substring search and context line support. No external dependency needed.

```rust
// Before (broken on Windows)
ProcessCommand::new("grep").arg("-rn").arg("--include=*.md")...

// After (cross-platform)
fn collect_files(dir: &Path, ext: &str) -> Vec<PathBuf> { ... }
// Walk files, search lines, print with color highlights
```

---

### 9. Deploy Dry-Run

```bash
sockt deploy --dry-run
```

**Status: PASS**

Shows the 6 processes that would be spawned:
- `gbrain-mcp` on port 3200
- `orch` on port 3100
- `cadvp` (daemon, no port)
- `agent-1`, `agent-2`, `agent-3` (daemons)

Estimated memory: ~1200 MB. No processes actually started.

---

### 10. Status

```bash
sockt status --json
```

**Status: PASS**

Returns `{"health": "down", "services": [], ...}` when no swarm running via `sockt deploy`. Correct — the CLI tracks only processes it spawned (PIDs in `~/.sockt/runtime.json`).

---

### 11. Ask

```bash
sockt ask "Summarise our top competitors" --json
```

**Status: PASS**

Task created in orchestrator, full JSON returned including `id`, `tenantId`, `status: "pending"`, `llmCallsBudget: 25`. Correct routing to orch at `http://localhost:3100`.

---

### 12. Tasks List

```bash
sockt tasks list --json
```

**Status: PASS** (after fix)

**Bug found:** `GET /tasks/pending` was being intercepted by `GET /tasks/:id` because dynamic route was registered before the static one in Hono.

**Fix:** Moved `GET /tasks/pending` above `GET /tasks/:id` in `packages/orch/src/api/routes/tasks.ts`. Hono matches in definition order.

```typescript
// Before (wrong order)
app.get("/tasks/:id", ...)      // ← ate /tasks/pending → 404
app.get("/tasks/pending", ...)

// After (correct order)
app.get("/tasks/pending", ...)  // ← static first
app.get("/tasks/:id", ...)
```

---

### 13. Tasks Show / Cancel / Approve / Reject / Retry

```bash
sockt tasks show <id>
sockt tasks cancel <id> --confirm
```

**Status: PASS** (after fix)

`tasks show` worked immediately.

**Bug found:** CLI calls `POST /tasks/:id/cancel`, `POST /tasks/:id/approve`, `POST /tasks/:id/reject`, `POST /tasks/:id/retry` — none of these routes existed in the orchestrator.

**Fix:** Added all four routes to `packages/orch/src/api/routes/tasks.ts`:
- `cancel` → sets status to `cancelled`
- `retry` → sets status back to `pending`
- `approve` → sets status back to `pending` (re-queues for agent)
- `reject` → sets status to `cancelled` with reason in output

---

### 14. Department List

```bash
sockt department list
```

**Status: PASS**

Lists 3 built-in templates with agents, tools, and use-case descriptions:
- `growth` — Lead Researcher, Outbound Writer, Social Monitor
- `product` — Product Architect, Coder Agent, QA Tester
- `engops` — Eng-Ops Architect, Deploy Worker, Sentry Monitor

---

### 15. Department Add

```bash
sockt department add growth
sockt department add research  # invalid
```

**Status: PASS**

`department add growth` activates the template and updates GBrain `AGENTS.md`.

`department add research` correctly returns `Error: Unknown department: 'research'. Available: growth, product, engops` — enforces valid template names.

---

### 16. Health

```bash
sockt health
```

**Status: PASS**

Returns per-service health with correct exit codes:
- Exit 0 — all pass
- Exit 1 — warnings
- Exit 2 — failures

When no swarm running: `Services ✖ No services running` with fix suggestion `sockt deploy`. Correct behaviour.

---

## Bugs Fixed

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| 1 | `rust/sockt-cli/Cargo.toml` | `nix` crate declared as regular dep but is Unix-only — build fails on Windows | Moved to `[target.'cfg(unix)'.dependencies]` |
| 2 | `rust/sockt-cli/src/lib.rs` | `pub mod logs` declared but `src/logs/` directory didn't exist | Created `src/logs/mod.rs`, `filter.rs`, `formatter.rs`, `reader.rs` |
| 3 | `rust/sockt-cli/src/runtime/mod.rs` | `is_process_alive` and `kill_process` used `nix` without `#[cfg(unix)]` | Added `#[cfg(unix)]` / `#[cfg(windows)]` branches using `tasklist` / `taskkill` |
| 4 | `rust/sockt-cli/src/commands/connect.rs` | `tokio::signal::unix::signal` — Unix-only, breaks Windows build | Replaced with cross-platform `tokio::signal::ctrl_c()` |
| 5 | `rust/sockt-cli/src/commands/logs.rs` | Same `tokio::signal::unix::signal` issue | Same fix |
| 6 | `rust/sockt-cli/src/commands/brain.rs` | `brain search` calls system `grep` binary, not available on Windows | Replaced with native Rust recursive file walker |
| 7 | All workspace `package.json` | Missing `"bun"` export condition — packages resolve to `./dist/index.js` which doesn't exist (packages not built) | Added `"bun": "./src/index.ts"` to exports in all 6 packages |
| 8 | `packages/orch/src/api/routes/tasks.ts` | `GET /tasks/:id` defined before `GET /tasks/pending` — Hono matches in order, so `/tasks/pending` requests returned 404 | Moved static route above parameterised route |
| 9 | `packages/orch/src/api/routes/tasks.ts` | Missing `POST /tasks/:id/cancel`, `approve`, `reject`, `retry` routes | Added all four |

---

## New Routes Added to Orchestrator

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tasks` | List all tasks for a tenant (with optional `?status=` filter) |
| `GET` | `/tasks/:id` | Get single task by ID |
| `PATCH` | `/tasks/:id` | Update task status or output |
| `POST` | `/tasks/:id/cancel` | Cancel a task |
| `POST` | `/tasks/:id/approve` | Approve (re-queue) an escalated task |
| `POST` | `/tasks/:id/reject` | Reject with reason |
| `POST` | `/tasks/:id/retry` | Retry a failed/escalated task |
| `GET` | `/agents` | List agents for a tenant |
| `POST` | `/agents/register` | Register a new agent |
| `DELETE` | `/agents/:id` | Deregister an agent |
| `GET` | `/approvals/pending` | List pending HITL approvals |

---

## Known Remaining Gaps

| Item | Notes |
|------|-------|
| `sockt deploy` (actual) | Not tested end-to-end on Windows — spawns Bun processes with `setsid()` which is Unix-only (already guarded with `#[cfg(unix)]`) |
| `sockt tasks approve/reject` via CLI | Routes added; not tested with a real escalated task requiring HITL decision |
| `sockt upgrade` | Requires a published GitHub release binary — not tested (no release published) |
| `sockt connect` / `sockt logs --follow` | Requires live agent processes writing to `~/.sockt/logs/` — not tested end-to-end |
| `sockt export` | Not tested; depends on GBrain git history |
| Department end-to-end | Agent tools (`analytics-query`, `deploy-manage`, etc.) are name-only in templates — no tool implementations wired to runtime yet |
| Memory (UI) | `GET /memory/search` not yet wired to `@sockt/memory` — UI stubs return empty |
| CADVP (UI) | No HTTP API on CADVP daemon — UI stubs return empty |
