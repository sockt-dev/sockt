import { test, expect, describe } from "bun:test";
import { cosineSimilarity } from "../dedup/cosine.ts";
import { DedupGate } from "../dedup/gate.ts";
import type { MemoryStore, RetrievalResult } from "@sockt/types";

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(1, 10);
  });

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  test("opposite vectors return -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  test("zero vectors return 0", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  test("throws on different lengths", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow("Vectors must have same length");
  });

  test("handles high-dimensional vectors", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });
});

describe("DedupGate", () => {
  function mockStore(searchResults: RetrievalResult[]): MemoryStore {
    return {
      write: async () => "",
      search: async () => searchResults,
      deduplicateCheck: async () => false,
      commit: async () => {},
      listCategories: async () => [],
      delete: async () => {},
    };
  }

  const highScoreResult: RetrievalResult = {
    entry: {
      id: "existing-1",
      tenantId: "t1",
      category: "fact",
      content: "existing content",
      source: "test",
      createdAt: "2024-01-01T00:00:00Z",
    },
    score: 0.95,
    rankSource: "vector",
  };

  test("returns true when score >= threshold", async () => {
    const gate = new DedupGate(mockStore([highScoreResult]));
    const result = await gate.isDuplicate("similar content", "t1");
    expect(result).toBe(true);
  });

  test("returns false when no results", async () => {
    const gate = new DedupGate(mockStore([]));
    const result = await gate.isDuplicate("novel content", "t1");
    expect(result).toBe(false);
  });

  test("returns false when score < threshold", async () => {
    const lowScoreResult = { ...highScoreResult, score: 0.85 };
    const gate = new DedupGate(mockStore([lowScoreResult]));
    const result = await gate.isDuplicate("somewhat similar", "t1");
    expect(result).toBe(false);
  });

  test("custom threshold overrides default 0.92", async () => {
    const result90 = { ...highScoreResult, score: 0.90 };
    const gate = new DedupGate(mockStore([result90]));

    // With default 0.92 threshold, 0.90 is not a duplicate
    expect(await gate.isDuplicate("content", "t1")).toBe(false);
    // With custom 0.88 threshold, 0.90 IS a duplicate
    expect(await gate.isDuplicate("content", "t1", 0.88)).toBe(true);
  });

  test("passes correct query parameters to store", async () => {
    let capturedQuery: unknown;
    const store: MemoryStore = {
      write: async () => "",
      search: async (query) => { capturedQuery = query; return []; },
      deduplicateCheck: async () => false,
      commit: async () => {},
      listCategories: async () => [],
      delete: async () => {},
    };

    const gate = new DedupGate(store, 0.92);
    await gate.isDuplicate("test content", "tenant-abc", 0.95);

    expect(capturedQuery).toEqual({
      tenantId: "tenant-abc",
      query: "test content",
      limit: 1,
      threshold: 0.95,
    });
  });
});
