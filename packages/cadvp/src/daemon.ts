import type { CadvpMonitor, CadvpEvent, CadvpStats, MemoryStore } from "@sockt/types";
import { CheckpointStore } from "./checkpoint-store.ts";
import { JsonlTailer } from "./jsonl-tailer.ts";
import { EventProcessor } from "./event-processor.ts";
import { DEFAULTS, type CadvpDaemonConfig } from "./config.ts";

export class CadvpDaemon implements CadvpMonitor {
  private readonly tailer: JsonlTailer;
  private readonly processor: EventProcessor;
  private readonly checkpoint: CheckpointStore;
  private handlers: Array<(event: CadvpEvent) => Promise<void>> = [];
  private stopped = false;

  constructor(config: CadvpDaemonConfig) {
    this.checkpoint = new CheckpointStore(config.checkpointPath);

    this.processor = new EventProcessor({
      store: config.store,
      dedupThreshold: config.dedupThreshold ?? DEFAULTS.dedupThreshold,
      batchSize: config.batchSize ?? DEFAULTS.batchSize,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      onEvent: async (event) => {
        for (const handler of this.handlers) {
          await handler(event);
        }
      },
    });

    this.tailer = new JsonlTailer({
      checkpointStore: this.checkpoint,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    });
  }

  async start(watchPaths: string[]): Promise<void> {
    this.stopped = false;
    await this.checkpoint.load();
    this.processor.startFlushTimer();
    await this.tailer.start(watchPaths, (line) => {
      this.processor.processLine(line);
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.tailer.stop();
    await this.processor.stop();
    await this.checkpoint.flush();
  }

  onEvent(handler: (event: CadvpEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  getStats(): CadvpStats {
    return this.processor.getStats();
  }
}
