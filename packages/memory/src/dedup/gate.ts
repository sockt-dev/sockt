import type { MemoryStore } from "@sockt/types";

export class DedupGate {
  constructor(
    private readonly store: MemoryStore,
    private readonly defaultThreshold: number = 0.92,
  ) {}

  async isDuplicate(
    content: string,
    tenantId: string,
    threshold?: number,
  ): Promise<boolean> {
    const t = threshold ?? this.defaultThreshold;
    const results = await this.store.search({
      tenantId,
      query: content,
      limit: 1,
      threshold: t,
    });
    return results.length > 0 && results[0]!.score >= t;
  }
}
