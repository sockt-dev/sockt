# @sockt/memory

Semantic memory retrieval for Sockt agents — a GBrain MCP client, deduplication by cosine similarity, and Reciprocal Rank Fusion for combining multiple ranked result sets into one. This is the client-side half of Sockt's memory pipeline; the ingestion half lives in `@sockt/cadvp`.

Agents never write to memory directly (that would make prompt injection a path to permanent memory poisoning) — this package is a *read* client plus the dedup logic CADVP uses when deciding what's worth writing in the first place.

## Install

```bash
bun add @sockt/memory
```

## What's in here

### `createMemoryStore(config)`

Factory that returns a `MemoryStore` (the interface from `@sockt/types`) backed by GBrain over MCP.

```typescript
import { createMemoryStore } from "@sockt/memory";

const memory = createMemoryStore({ endpoint: "http://localhost:3200", timeoutMs: 5000, retries: 2 });
const results = await memory.retrieve({ query: "competitor pricing strategies", topK: 5 });
```

### `GBrainMcpClient`

The concrete `MemoryStore` implementation `createMemoryStore` returns — use directly if you need the class rather than the factory.

### `DedupGate`

Decides whether a new memory candidate is different enough from existing entries to be worth storing, using cosine similarity against a configurable threshold (default `0.92` — matching what `@sockt/cadvp` uses in the ingestion pipeline).

### `RrfRanker`

Combines multiple independently-ranked result lists (e.g. results from different retrieval strategies) into a single fused ranking using Reciprocal Rank Fusion — no need to normalize scores across sources first.

### `cosineSimilarity(a, b)`

The raw similarity function `DedupGate` is built on, exported standalone for when you need just the number.

## Usage

```typescript
import { createMemoryStore, DedupGate, RrfRanker } from "@sockt/memory";

const memory = createMemoryStore({ endpoint: process.env.GBRAIN_URL! });

const dedup = new DedupGate({ threshold: 0.92 });
const isDuplicate = await dedup.check(newEntryEmbedding, existingEmbeddings);

const ranker = new RrfRanker();
const fused = ranker.fuse([resultsFromSourceA, resultsFromSourceB]);
```

## Docs

Memory pipeline architecture: [docs/ARCHITECTURE.md#memory-pipeline-cadvp--gbrain](https://github.com/sockt-dev/sockt/blob/main/docs/ARCHITECTURE.md#memory-pipeline-cadvp--gbrain)

## License

[FSL-1.1-MIT](./LICENSE.md) — free for non-competing use, converts to MIT two years after each release.
