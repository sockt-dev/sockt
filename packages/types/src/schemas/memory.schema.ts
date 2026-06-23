import { z } from "zod";
import { MEMORY_CATEGORY_VALUES } from "../types/memory.ts";

export const MemoryEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  category: z.enum(MEMORY_CATEGORY_VALUES),
  content: z.string(),
  source: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  embedding: z.array(z.number()).optional(),
  createdAt: z.string().datetime(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const RetrievalQuerySchema = z.object({
  tenantId: z.string(),
  query: z.string(),
  categories: z.array(z.enum(MEMORY_CATEGORY_VALUES)).optional(),
  limit: z.number().int().positive().optional(),
  threshold: z.number().min(0).max(1).optional(),
});
export type RetrievalQuery = z.infer<typeof RetrievalQuerySchema>;

const RankSource = {
  Vector: "vector",
  Text: "text",
  Rrf: "rrf",
} as const;
const RANK_SOURCE_VALUES = Object.values(RankSource) as [string, ...string[]];

export const RetrievalResultSchema = z.object({
  entry: MemoryEntrySchema,
  score: z.number(),
  rankSource: z.enum(RANK_SOURCE_VALUES),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;
