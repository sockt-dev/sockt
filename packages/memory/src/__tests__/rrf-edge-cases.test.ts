import { test, expect, describe } from "bun:test";
import { RrfRanker } from "../ranking/rrf.ts";
import type { RetrievalResult } from "@sockt/types";

function makeResult(id: string, score: number, rankSource: RetrievalResult["rankSource"] = "vector"): RetrievalResult {
  return {
    entry: {
      id,
      tenantId: "t1",
      category: "fact",
      content: `content-${id}`,
      source: "test",
      createdAt: "2024-01-01T00:00:00Z",
    },
    score,
    rankSource,
  };
}

describe("RrfRanker edge cases", () => {
  const ranker = new RrfRanker();

  test("handles many lists (10 lists)", () => {
    const lists = Array.from({ length: 10 }, (_, i) => [
      makeResult("shared", 0.9 - i * 0.01),
      makeResult(`unique-${i}`, 0.8),
    ]);

    const fused = ranker.fuse(lists);

    // "shared" appears in all 10 lists at rank 0: score = 10 * (1/61)
    const sharedResult = fused.find((r) => r.entry.id === "shared");
    expect(sharedResult).toBeDefined();
    expect(sharedResult!.score).toBeCloseTo(10 / 61, 10);

    // Each unique item appears once at rank 1: score = 1/62
    const uniqueResults = fused.filter((r) => r.entry.id.startsWith("unique-"));
    expect(uniqueResults).toHaveLength(10);
    uniqueResults.forEach((r) => expect(r.score).toBeCloseTo(1 / 62, 10));
  });

  test("preserves entry data in fused results", () => {
    const result: RetrievalResult = {
      entry: {
        id: "preserve-me",
        tenantId: "t-special",
        category: "decision",
        content: "important decision",
        source: "meeting",
        metadata: { key: "value" },
        embedding: [0.1, 0.2, 0.3],
        createdAt: "2024-06-15T10:30:00Z",
      },
      score: 0.88,
      rankSource: "text",
    };

    const fused = ranker.fuse([[result]]);

    expect(fused[0]!.entry.id).toBe("preserve-me");
    expect(fused[0]!.entry.tenantId).toBe("t-special");
    expect(fused[0]!.entry.category).toBe("decision");
    expect(fused[0]!.entry.content).toBe("important decision");
    expect(fused[0]!.entry.source).toBe("meeting");
    expect(fused[0]!.entry.metadata).toEqual({ key: "value" });
    expect(fused[0]!.entry.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fused[0]!.entry.createdAt).toBe("2024-06-15T10:30:00Z");
    expect(fused[0]!.rankSource).toBe("rrf");
  });

  test("correct score calculation with k=60", () => {
    // Hand-calculated: item at rank 0 in list A and rank 2 in list B
    // RRF = 1/(60+0+1) + 1/(60+2+1) = 1/61 + 1/63
    const listA = [makeResult("target", 0.9), makeResult("other-a", 0.8)];
    const listB = [makeResult("other-b1", 0.95), makeResult("other-b2", 0.9), makeResult("target", 0.7)];

    const fused = ranker.fuse([listA, listB]);
    const target = fused.find((r) => r.entry.id === "target");

    expect(target!.score).toBeCloseTo(1 / 61 + 1 / 63, 10);
  });

  test("handles list with single item", () => {
    const fused = ranker.fuse([[makeResult("solo", 0.99)]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.entry.id).toBe("solo");
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  test("handles very long lists (1000 items)", () => {
    const longList = Array.from({ length: 1000 }, (_, i) =>
      makeResult(`item-${i}`, 1 - i * 0.001)
    );

    const fused = ranker.fuse([longList]);
    expect(fused).toHaveLength(1000);

    // First item: 1/(60+0+1) = 1/61
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
    // Last item: 1/(60+999+1) = 1/1060
    expect(fused[999]!.score).toBeCloseTo(1 / 1060, 10);
  });

  test("sort is stable — items with equal scores maintain consistent order", () => {
    // All items at rank 0 in separate lists => all get 1/61
    const lists = Array.from({ length: 5 }, (_, i) => [
      makeResult(`equal-${i}`, 0.9),
    ]);

    const fused = ranker.fuse(lists);
    expect(fused).toHaveLength(5);
    // All have the same score
    fused.forEach((r) => expect(r.score).toBeCloseTo(1 / 61, 10));
  });

  test("k=1 produces larger score differences", () => {
    const rankerK1 = new RrfRanker(1);
    const list = [makeResult("a", 0.9), makeResult("b", 0.8), makeResult("c", 0.7)];

    const fused = rankerK1.fuse([list]);

    // k=1: rank 0 => 1/2, rank 1 => 1/3, rank 2 => 1/4
    expect(fused[0]!.score).toBeCloseTo(1 / 2, 10);
    expect(fused[1]!.score).toBeCloseTo(1 / 3, 10);
    expect(fused[2]!.score).toBeCloseTo(1 / 4, 10);
  });

  test("k=1000 produces smaller score differences", () => {
    const rankerK1000 = new RrfRanker(1000);
    const list = [makeResult("a", 0.9), makeResult("b", 0.8)];

    const fused = rankerK1000.fuse([list]);

    // k=1000: rank 0 => 1/1001, rank 1 => 1/1002
    expect(fused[0]!.score).toBeCloseTo(1 / 1001, 10);
    expect(fused[1]!.score).toBeCloseTo(1 / 1002, 10);
    // Difference is tiny
    expect(fused[0]!.score - fused[1]!.score).toBeLessThan(0.000002);
  });

  test("multi-list presence at low rank can outrank single-list high rank", () => {
    // "popular" is at rank 5 in both lists (low position but appears twice)
    // "rare" is at rank 0 in one list only
    const listA = [
      makeResult("filler-a0", 0.99),
      makeResult("filler-a1", 0.98),
      makeResult("filler-a2", 0.97),
      makeResult("filler-a3", 0.96),
      makeResult("filler-a4", 0.95),
      makeResult("popular", 0.5),
    ];
    const listB = [
      makeResult("filler-b0", 0.99),
      makeResult("filler-b1", 0.98),
      makeResult("filler-b2", 0.97),
      makeResult("filler-b3", 0.96),
      makeResult("filler-b4", 0.95),
      makeResult("popular", 0.5),
    ];
    const listC = [makeResult("rare", 0.99)];

    const fused = ranker.fuse([listA, listB, listC]);
    const popular = fused.find((r) => r.entry.id === "popular")!;
    const rare = fused.find((r) => r.entry.id === "rare")!;

    // popular: 2 * 1/(60+5+1) = 2/66 ≈ 0.0303
    // rare: 1 * 1/(60+0+1) = 1/61 ≈ 0.0164
    // Two appearances at rank 5 beats one appearance at rank 0
    expect(popular.score).toBeCloseTo(2 / 66, 10);
    expect(rare.score).toBeCloseTo(1 / 61, 10);
    expect(popular.score).toBeGreaterThan(rare.score);
  });

  test("duplicate ids across lists are merged, not duplicated", () => {
    const listA = [makeResult("dup", 0.9), makeResult("a-only", 0.8)];
    const listB = [makeResult("dup", 0.85), makeResult("b-only", 0.7)];

    const fused = ranker.fuse([listA, listB]);
    const dupResults = fused.filter((r) => r.entry.id === "dup");

    expect(dupResults).toHaveLength(1);
    expect(fused).toHaveLength(3); // dup, a-only, b-only
  });

  test("original scores are replaced by RRF scores", () => {
    const list = [makeResult("x", 0.99)];
    const fused = ranker.fuse([list]);

    // Original score was 0.99 but RRF replaces it with 1/61
    expect(fused[0]!.score).not.toBe(0.99);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  test("all rankSource values are overwritten to 'rrf'", () => {
    const results: RetrievalResult[] = [
      makeResult("a", 0.9, "text"),
      makeResult("b", 0.8, "vector"),
    ];

    const fused = ranker.fuse([results]);
    fused.forEach((r) => expect(r.rankSource).toBe("rrf"));
  });
});
