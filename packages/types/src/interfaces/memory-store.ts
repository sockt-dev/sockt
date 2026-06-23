import type { MemoryEntry, RetrievalQuery, RetrievalResult } from "../schemas/memory.schema.ts";
import type { MemoryCategory } from "../types/memory.ts";

export interface MemoryStore {
  write(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string>;
  search(query: RetrievalQuery): Promise<RetrievalResult[]>;
  deduplicateCheck(content: string, tenantId: string, threshold: number): Promise<boolean>;
  commit(tenantId: string, message: string): Promise<void>;
  listCategories(tenantId: string): Promise<MemoryCategory[]>;
  delete(entryId: string): Promise<void>;
}
