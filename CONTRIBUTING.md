# Contributing to Sockt

Thanks for considering a contribution. Sockt is a TypeScript + Rust monorepo
under active development — this guide covers everything you need to get a
change from idea to merged PR.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Prerequisites](#prerequisites)
- [Getting Set Up](#getting-set-up)
- [Repository Layout](#repository-layout)
- [Development Conventions](#development-conventions)
- [Running Tests](#running-tests)
- [Making a Pull Request](#making-a-pull-request)
- [Adding a New Package](#adding-a-new-package)
- [Adding a Department Skill](#adding-a-department-skill)
- [Reporting Bugs](#reporting-bugs)
- [Security Issues](#security-issues)

---

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| [Bun](https://bun.sh) | ≥1.3 | Runtime for all TypeScript packages, package manager, test runner |
| [Rust](https://rustup.rs) | stable | Builds the `sockt` CLI |
| Git | any recent | — |
| [Docker AI Sandbox (`sbx`)](https://docs.docker.com/ai/sandboxes/) | optional | Only needed to test `exec_code` with real microVM isolation |

We do not use Node.js, npm, yarn, or pnpm anywhere in this repo — see
[`CLAUDE.md`](CLAUDE.md) for the full list of Bun-native APIs we use instead
of their Node equivalents (`bun:sqlite` not `better-sqlite3`, `Bun.serve()`
not Express, etc.). PRs that reintroduce Node-only tooling will be asked to
convert to the Bun equivalent.

## Getting Set Up

```bash
git clone https://github.com/sockt-dev/sockt
cd sockt
bun install

cp .env.example .env
# fill in MODEL_API_KEY at minimum — see docs/CONFIGURATION.md

cd rust/sockt-cli
cargo build
```

Verify everything works:

```bash
bun test                                    # TypeScript test suite
cd rust/sockt-cli && cargo test             # Rust CLI test suite
```

To run the full stack locally without the CLI (useful while iterating on a
single package):

```bash
bun run orch    # orchestrator on :3100
bun run ui      # dashboard on :3001
bun run packages/runtime/src/serve.ts   # one agent worker
```

## Repository Layout

```
packages/
  types/      shared Zod schemas + TS interfaces — the dependency root
  fsm/        task state machine, SQLite store, budget guard
  memory/     vector search, dedup, MCP brain client
  orch/       orchestrator HTTP API, agent registry, department templates
  runtime/    agent execution loop (Plan→Act→Observe→Reflect), built-in tools
  cadvp/      JSONL tail daemon → memory ingestion
  gbrain-mcp/ local MCP memory server
  ui/         React control-plane dashboard
rust/
  sockt-cli/  the `sockt` binary — deploy/status/tasks/brain/department/...
docs/         architecture, API reference, configuration, departments
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how these fit together.

## Development Conventions

**TypeScript**
- Bun-native APIs only — `bun:sqlite`, `Bun.serve()`, `Bun.file()`, `Bun.$` — never their npm equivalents. Full list in [CLAUDE.md](CLAUDE.md).
- Strict TypeScript. No `any` unless there's a comment explaining why.
- Each package's public surface is its `src/index.ts` barrel export — internal modules are not meant to be imported directly across package boundaries.
- Zod validation happens **at system boundaries** (API routes, task creation) — not sprinkled through internal logic.

**Rust**
- `cargo fmt` and `cargo clippy` clean before pushing.
- Unix-only APIs (`nix` crate, `tokio::signal::unix`) must be behind `#[cfg(unix)]` with a `#[cfg(windows)]` fallback — this codebase is developed and tested on Windows as well as Unix. See `rust/sockt-cli/src/runtime/mod.rs` for the pattern (`is_process_alive`, `kill_process`).

**Both**
- No comments explaining *what* code does — only *why*, when the reasoning is non-obvious (a workaround, an invariant, a subtlety a future reader would trip on).
- Don't add abstractions, config flags, or error handling for cases that can't happen. Match the scope of the change to the task.

## Running Tests

```bash
# TypeScript — all packages
bun test

# TypeScript — one package
bun test packages/fsm

# Rust CLI
cd rust/sockt-cli
cargo test

# Rust CLI — one test file
cargo test --test tasks_integration
```

CI runs both suites on every PR (see `.github/workflows/`). A PR won't merge
with failing tests.

### Manual/integration verification

Some behavior (agent loops actually completing tasks against a live LLM,
department end-to-end runs, Docker Sandbox execution) isn't covered by unit
tests and needs to be run manually — start `orch` + `runtime` locally, fire a
task with `sockt ask` or a raw `POST /tasks`, and confirm the task reaches
`completed`. If your change touches the agent runner, the FSM transitions,
or a built-in tool, please describe what manual verification you did in the
PR description.

## Making a Pull Request

1. Fork the repo (or branch directly if you have write access) and create a
   branch: `git checkout -b fix/short-description` or `feat/short-description`
2. Make your change, with tests for new behavior
3. Run `bun test` (and `cargo test` if you touched Rust)
4. Commit with a clear message describing *why*, not just *what*
5. Open a PR against `main`. Fill in the PR template — it asks for a summary
   and a test plan
6. Address review feedback — we may ask for changes before merge

We squash-merge by default, so your commit history within the branch can be
messy; the PR title/description becomes the final commit message.

### What makes a PR merge faster

- Small, focused diffs over large multi-purpose ones
- A clear "why" in the description — link the issue if there is one
- Tests that would have failed before your fix and pass after
- No unrelated formatting/refactor noise mixed into a bug fix

## Adding a New Package

If you're adding a new `@sockt/*` package:

1. Add `packages/<name>/package.json` with `"bun"` export condition pointing
   at `./src/index.ts` (see any existing package — this lets Bun resolve the
   workspace package from source without a build step during development)
2. Add a `build` script following the pattern in existing packages (bundles
   with `bun build`, excludes `@sockt/*` and other workspace deps as external)
3. Add it to the root `bun run build` script chain in `package.json`
4. Export its public types from `@sockt/types` if other packages need to
   reference them

## Adding a Department Skill

Departments (`growth`, `product`, `engops`) each have a `SKILLS_INDEX.md` and
a set of pre-compiled `.skill` JSON files under
`packages/orch/src/registry/skills/<department>/`. See
[docs/DEPARTMENTS.md](docs/DEPARTMENTS.md) for the full format and an example
of adding a new skill or a new department template.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when
opening an issue. Include: what you ran, what you expected, what happened,
and your Bun/Rust/OS versions. If it's reproducible with a specific task
description or department, include that verbatim — we'll use it to write a
regression test.

## Security Issues

**Do not** open a public issue for a security vulnerability — see
[SECURITY.md](SECURITY.md) for the private disclosure process.
