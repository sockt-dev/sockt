export const CadvpEventType = {
  MemoryWrite: "memory_write",
  MemoryUpdate: "memory_update",
  MemoryDelete: "memory_delete",
  Sync: "sync",
} as const;
export type CadvpEventType = (typeof CadvpEventType)[keyof typeof CadvpEventType];
export const CADVP_EVENT_TYPE_VALUES = Object.values(CadvpEventType) as [CadvpEventType, ...CadvpEventType[]];

export interface CadvpStats {
  eventsProcessed: number;
  eventsDeduplicated: number;
  eventsErrored: number;
  lastProcessedAt: string | null;
}
