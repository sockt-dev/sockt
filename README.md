# Sockt

Agent swarms. Budget-enforced. Memory-persistent. No runaway loops.

```bash
bun install && bun test
```

## The Problem

Multi-agent systems fail in production: runaway loops burn API budgets, agents forget everything between runs, and credentials leak through prompt injection.

## The Fix

- **FSM per task** — enforced state machine with per-task LLM call cap. Budget exceeded → auto-escalate, never loop.
- **Async memory** — execution logs to JSONL, CADVP daemon deduplicates and persists. Agents remember across runs.
- **Isolated vaults** — credentials stay out of context windows.

## Stack

Bun · TypeScript · SQLite · Hono · Zod · Vercel AI SDK (Anthropic, OpenAI, Google, Ollama)

## Packages

`types` `fsm` `memory` `orch` `runtime` `cadvp`

## License

FSL-1.1-MIT — non-competing use now, full MIT after 2 years.
