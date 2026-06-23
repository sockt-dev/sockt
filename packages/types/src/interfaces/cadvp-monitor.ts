import type { CadvpEvent } from "../schemas/cadvp.schema.ts";
import type { CadvpStats } from "../types/cadvp.ts";

export interface CadvpMonitor {
  start(watchPaths: string[]): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: CadvpEvent) => Promise<void>): void;
  getStats(): CadvpStats;
}
