import type { RetrievalResult } from "@sockt/types";

export class RrfRanker {
  constructor(private readonly k: number = 60) {}

  fuse(rankedLists: RetrievalResult[][]): RetrievalResult[] {
    const scores = new Map<string, { score: number; entry: RetrievalResult }>();

    for (const list of rankedLists) {
      for (let rank = 0; rank < list.length; rank++) {
        const item = list[rank]!;
        const entryId = item.entry.id;
        const rrfScore = 1 / (this.k + rank + 1);

        const existing = scores.get(entryId);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scores.set(entryId, {
            score: rrfScore,
            entry: { ...item, rankSource: "rrf" },
          });
        }
      }
    }

    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .map(({ score, entry }) => ({ ...entry, score }));
  }
}
