import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { CheckpointStore } from "./checkpoint-store.ts";

export interface TailerOptions {
  checkpointStore: CheckpointStore;
  pollIntervalMs?: number;
}

export type LineHandler = (line: string, filePath: string) => void;

export class JsonlTailer {
  private watchers = new Map<string, FSWatcher>();
  private pollTimers = new Map<string, Timer>();
  private handler: LineHandler | null = null;
  private readonly pollIntervalMs: number;
  private readonly checkpoint: CheckpointStore;
  private stopped = false;
  private reading = new Set<string>();

  constructor(options: TailerOptions) {
    this.checkpoint = options.checkpointStore;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  async start(filePaths: string[], onLine: LineHandler): Promise<void> {
    this.handler = onLine;
    this.stopped = false;

    for (const filePath of filePaths) {
      await this.readNewLines(filePath);
      this.startWatching(filePath);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    for (const [, timer] of this.pollTimers) {
      clearInterval(timer);
    }
    this.pollTimers.clear();

    this.handler = null;
  }

  private startWatching(filePath: string): void {
    try {
      const watcher = watch(filePath, (eventType) => {
        if (eventType === "change" && !this.stopped) {
          this.readNewLines(filePath);
        }
      });
      this.watchers.set(filePath, watcher);
    } catch {
      // Fallback to polling only
    }

    const timer = setInterval(() => {
      if (!this.stopped) {
        this.readNewLines(filePath);
      }
    }, this.pollIntervalMs);
    this.pollTimers.set(filePath, timer);
  }

  private async readNewLines(filePath: string): Promise<void> {
    if (this.stopped || this.reading.has(filePath)) return;
    this.reading.add(filePath);

    try {
      const currentOffset = this.checkpoint.getOffset(filePath);
      let fileSize: number;

      try {
        const s = await stat(filePath);
        fileSize = s.size;
      } catch {
        return;
      }

      if (fileSize <= currentOffset) return;

      const fd = await open(filePath, "r");
      try {
        const readLength = fileSize - currentOffset;
        const buffer = Buffer.alloc(readLength);
        await fd.read(buffer, 0, readLength, currentOffset);

        const text = buffer.toString("utf-8");
        const lines = text.split("\n");

        // Last element: empty string if text ends with \n, or partial line
        const last = lines.pop()!;
        const hasPartial = last.length > 0;

        let advancedOffset = currentOffset;
        for (const line of lines) {
          advancedOffset += Buffer.byteLength(line, "utf-8") + 1; // +1 for \n
          if (line.trim().length === 0) continue;
          this.handler?.(line, filePath);
        }

        // Only advance offset to cover complete lines — partial stays unread
        if (!hasPartial) {
          this.checkpoint.setOffset(filePath, advancedOffset);
        } else {
          // Advance past complete lines only
          this.checkpoint.setOffset(filePath, advancedOffset);
        }
      } finally {
        await fd.close();
      }
    } finally {
      this.reading.delete(filePath);
    }
  }
}
