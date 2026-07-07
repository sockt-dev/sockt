# @sockt/cadvp

The memory ingestion daemon — tails agent execution logs (JSONL), validates and deduplicates events, batches them, and writes to a `MemoryStore` (typically GBrain via `@sockt/memory`). This is the write-side half of Sockt's memory pipeline; `@sockt/memory` is the read-side client.

Agents never write to memory directly. Every execution step gets appended to a JSONL file; CADVP is the only thing that turns those log lines into durable memory — which keeps the hot agent-execution path fast and keeps prompt injection from being a direct path to memory poisoning.

## Install

```bash
bun add @sockt/cadvp
```

## What's in here

### `CadvpDaemon`

The top-level daemon. Wires together a `JsonlTailer`, `SchemaValidator`, `EventProcessor`, and `CheckpointStore` into a running loop.

```typescript
import { CadvpDaemon, DEFAULTS } from "@sockt/cadvp";
import { createMemoryStore } from "@sockt/memory";

const daemon = new CadvpDaemon({
  store: createMemoryStore({ endpoint: process.env.GBRAIN_URL! }),
  checkpointPath: "~/.sockt/scratch/cadvp-checkpoint.json",
  dedupThreshold: DEFAULTS.dedupThreshold, // 0.92
  batchSize: DEFAULTS.batchSize,           // 10
  flushIntervalMs: DEFAULTS.flushIntervalMs, // 2000
  pollIntervalMs: DEFAULTS.pollIntervalMs,   // 500
});

await daemon.start();
```

### `JsonlTailer`

Watches a JSONL file (agent execution log) for new lines, polling at `pollIntervalMs`. Resilient to the file being rotated or not existing yet at startup.

### `SchemaValidator`

Validates each incoming event line against the `CadvpEvent` schema (from `@sockt/types`) before it's processed — malformed lines are skipped, not thrown.

### `EventProcessor`

Deduplicates new events against existing memory using cosine similarity (`dedupThreshold`, default `0.92`), batches non-duplicate events (`batchSize`), and flushes to the `MemoryStore` on a timer (`flushIntervalMs`).

### `CheckpointStore`

Persists how far the tailer has read into the log file, so a daemon restart resumes instead of reprocessing (or missing) events.

### `DEFAULTS`

The default config values above, exported so you can reference or partially override them rather than hardcoding magic numbers.

## Environment variables

`GBRAIN_URL`, `WATCH_DIR`, `CHECKPOINT_PATH` — full reference in [docs/CONFIGURATION.md](https://github.com/sockt-dev/sockt/blob/main/docs/CONFIGURATION.md).

## Docs

Memory pipeline architecture: [docs/ARCHITECTURE.md#memory-pipeline-cadvp--gbrain](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md#memory-pipeline-cadvp--gbrain)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
