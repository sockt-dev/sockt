import type { MemoryStore } from "@sockt/types";
import type { GBrainConfig } from "./config.ts";
import { GBrainMcpClient } from "./gbrain/client.ts";

export function createMemoryStore(config: GBrainConfig): MemoryStore {
  return new GBrainMcpClient(config);
}
