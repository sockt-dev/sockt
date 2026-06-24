import type { MemoryStore, CadvpEvent, CadvpStats } from "@sockt/types";
import { SchemaValidator } from "./schema-validator.ts";
import { DEFAULTS } from "./config.ts";

export interface EventProcessorConfig {
  store: MemoryStore;
  dedupThreshold?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  onEvent?: (event: CadvpEvent) => Promise<void>;
}

export class EventProcessor {
  private readonly store: MemoryStore;
  private readonly dedupThreshold: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly onEvent?: (event: CadvpEvent) => Promise<void>;
  private readonly validator = new SchemaValidator();

  private batch: CadvpEvent[] = [];
  private flushTimer: Timer | null = null;
  private stats: CadvpStats = {
    eventsProcessed: 0,
    eventsDeduplicated: 0,
    eventsErrored: 0,
    lastProcessedAt: null,
  };

  constructor(config: EventProcessorConfig) {
    this.store = config.store;
    this.dedupThreshold = config.dedupThreshold ?? DEFAULTS.dedupThreshold;
    this.batchSize = config.batchSize ?? DEFAULTS.batchSize;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
    this.onEvent = config.onEvent;
  }

  async processLine(line: string): Promise<void> {
    const result = this.validator.validate(line);
    if (!result.ok) {
      this.stats.eventsErrored++;
      return;
    }

    this.batch.push(result.event);
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const events = this.batch;
    this.batch = [];

    const tenantIds = new Set<string>();

    for (const event of events) {
      try {
        await this.processEvent(event);
        tenantIds.add(event.tenantId);
      } catch {
        this.stats.eventsErrored++;
      }
    }

    for (const tenantId of tenantIds) {
      try {
        await this.store.commit(tenantId, "cadvp-batch");
      } catch {
        // commit failure is non-fatal
      }
    }
  }

  private async processEvent(event: CadvpEvent): Promise<void> {
    switch (event.type) {
      case "memory_write":
      case "memory_update": {
        const isDuplicate = await this.store.deduplicateCheck(
          event.entry.content,
          event.tenantId,
          this.dedupThreshold,
        );

        if (isDuplicate) {
          this.stats.eventsDeduplicated++;
          return;
        }

        const { id, createdAt, ...payload } = event.entry;
        await this.store.write(payload);
        this.stats.eventsProcessed++;
        this.stats.lastProcessedAt = new Date().toISOString();
        await this.onEvent?.(event);
        break;
      }
      case "memory_delete": {
        await this.store.delete(event.entry.id);
        this.stats.eventsProcessed++;
        this.stats.lastProcessedAt = new Date().toISOString();
        await this.onEvent?.(event);
        break;
      }
      case "sync": {
        await this.store.commit(event.tenantId, `sync from ${event.agentId}`);
        this.stats.eventsProcessed++;
        this.stats.lastProcessedAt = new Date().toISOString();
        await this.onEvent?.(event);
        break;
      }
    }
  }

  startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
  }

  getStats(): CadvpStats {
    return { ...this.stats };
  }
}
