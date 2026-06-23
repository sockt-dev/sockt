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

describe("RrfRanker", () => {
  const ranker = new RrfRanker();

  test("fuses two lists with overlapping items", () => {
    const listA = [makeResult("a", 0.9), makeResult("b", 0.8)];
    const listB = [makeResult("b", 0.95), makeResult("a", 0.7)];

    const fused = ranker.fuse([listA, listB]);

    // "a" is rank 0 in listA (1/61) and rank 1 in listB (1/62) = 1/61 + 1/62
    // "b" is rank 1 in listA (1/62) and rank 0 in listB (1/61) = 1/62 + 1/61
    // Both should have the same RRF score
    expect(fused).toHaveLength(2);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 10);
    expect(fused[0]!.rankSource).toBe("rrf");
    expect(fused[1]!.rankSource).toBe("rrf");
  });

  test("single list returns items in original order", () => {
    const list = [makeResult("x", 0.9), makeResult("y", 0.8), makeResult("z", 0.7)];
    const fused = ranker.fuse([list]);

    expect(fused).toHaveLength(3);
    expect(fused[0]!.entry.id).toBe("x");
    expect(fused[1]!.entry.id).toBe("y");
    expect(fused[2]!.entry.id).toBe("z");
    // Scores should be decreasing
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
    expect(fused[1]!.score).toBeGreaterThan(fused[2]!.score);
  });

  test("disjoint lists interleave by RRF score", () => {
    const listA = [makeResult("a1", 0.9), makeResult("a2", 0.8)];
    const listB = [makeResult("b1", 0.95), makeResult("b2", 0.7)];

    const fused = ranker.fuse([listA, listB]);

    // All rank-0 items get 1/61, all rank-1 items get 1/62
    // a1 and b1 both have score 1/61, a2 and b2 both have score 1/62
    expect(fused).toHaveLength(4);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(fused[2]!.score).toBeCloseTo(1 / 62, 10);
  });

  test("empty input returns empty output", () => {
    expect(ranker.fuse([])).toEqual([]);
    expect(ranker.fuse([[]])).toEqual([]);
  });

  test("custom k parameter changes scores", () => {
    const rankerK10 = new RrfRanker(10);
    const list = [makeResult("a", 0.9)];

    const fused = rankerK10.fuse([list]);
    // With k=10, rank 0 item gets 1/(10+0+1) = 1/11
    expect(fused[0]!.score).toBeCloseTo(1 / 11, 10);
  });

  test("item appearing in multiple lists accumulates score", () => {
    const listA = [makeResult("shared", 0.9)];
    const listB = [makeResult("shared", 0.8)];
    const listC = [makeResult("shared", 0.7)];

    const fused = ranker.fuse([listA, listB, listC]);
    // rank 0 in all three lists: 3 * (1/61)
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(3 / 61, 10);
  });
});
