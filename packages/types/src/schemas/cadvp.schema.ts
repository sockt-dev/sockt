import { z } from "zod";
import { CADVP_EVENT_TYPE_VALUES } from "../types/cadvp.ts";
import { MemoryEntrySchema } from "./memory.schema.ts";

export const CadvpEventSchema = z.object({
  type: z.enum(CADVP_EVENT_TYPE_VALUES),
  tenantId: z.string(),
  agentId: z.string(),
  entry: MemoryEntrySchema,
  timestamp: z.string().datetime(),
  traceId: z.string().optional(),
});
export type CadvpEvent = z.infer<typeof CadvpEventSchema>;

export const CadvpStatsSchema = z.object({
  eventsProcessed: z.number().int().nonnegative(),
  eventsDeduplicated: z.number().int().nonnegative(),
  eventsErrored: z.number().int().nonnegative(),
  lastProcessedAt: z.string().datetime().nullable(),
});
export type CadvpStats = z.infer<typeof CadvpStatsSchema>;
