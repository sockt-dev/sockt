import type { MemoryStore } from "@sockt/types";

export interface CadvpDaemonConfig {
  store: MemoryStore;
  checkpointPath: string;
  dedupThreshold?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  pollIntervalMs?: number;
}

export const DEFAULTS = {
  dedupThreshold: 0.92,
  batchSize: 10,
  flushIntervalMs: 2000,
  pollIntervalMs: 500,
} as const;
