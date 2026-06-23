import { test, expect, describe } from "bun:test";
import { cosineSimilarity } from "../dedup/cosine.ts";
import { DedupGate } from "../dedup/gate.ts";
import type { MemoryStore, RetrievalResult } from "@sockt/types";

describe("cosineSimilarity edge cases", () => {
  test("single dimension vectors", () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1, 10);
  });

  test("very small values (near zero)", () => {
    const a = [1e-10, 1e-10];
    const b = [1e-10, 1e-10];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("very large values", () => {
    const a = [1e10, 1e10];
    const b = [1e10, 1e10];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("mixed positive and negative", () => {
    const a = [1, -1, 1, -1];
    const b = [1, -1, 1, -1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  test("perpendicular in 3D", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0, 0], [0, 0, 1])).toBeCloseTo(0, 10);
  });

  test("45 degree angle", () => {
    // cos(45°) = √2/2 ≈ 0.7071
    const a = [1, 0];
    const b = [1, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT2 / 2, 10);
  });

  test("high dimensional vectors (1536 dims - OpenAI embedding size)", () => {
    const a = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  test("high dimensional nearly-identical vectors", () => {
    const a = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 1536 }, (_, i) => Math.sin(i) + 0.001);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.99);
    expect(sim).toBeLessThan(1.0);
  });

  test("one vector is a scalar multiple of another", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  test("negative scalar multiple", () => {
    const a = [1, 2, 3];
    const b = [-2, -4, -6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  test("one zero vector, one non-zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  test("empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test("throws on mismatched lengths", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow();
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow();
  });
});

describe("DedupGate edge cases", () => {
  function mockStoreWithSearch(
    searchFn: (query: { tenantId: string; query: string; limit?: number; threshold?: number }) => RetrievalResult[],
  ): MemoryStore {
    return {
      write: async () => "",
      search: async (q) => searchFn(q),
      deduplicateCheck: async () => false,
      commit: async () => {},
      listCategories: async () => [],
      delete: async () => {},
    };
  }

  test("propagates errors from store.search", async () => {
    const failingStore: MemoryStore = {
      write: async () => "",
      search: async () => { throw new Error("search failed"); },
      deduplicateCheck: async () => false,
      commit: async () => {},
      listCategories: async () => [],
      delete: async () => {},
    };

    const gate = new DedupGate(failingStore);
    await expect(gate.isDuplicate("test", "t1")).rejects.toThrow("search failed");
  });

  test("handles score exactly at boundary (0.92)", async () => {
    const store = mockStoreWithSearch(() => [{
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      score: 0.92,
      rankSource: "vector",
    }]);

    const gate = new DedupGate(store);
    expect(await gate.isDuplicate("x", "t1")).toBe(true);
  });

  test("handles score at 0.9199999 (just below)", async () => {
    const store = mockStoreWithSearch(() => [{
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      score: 0.9199999,
      rankSource: "vector",
    }]);

    const gate = new DedupGate(store);
    expect(await gate.isDuplicate("x", "t1")).toBe(false);
  });

  test("uses correct tenantId in query", async () => {
    let capturedTenantId = "";
    const store = mockStoreWithSearch((q) => {
      capturedTenantId = q.tenantId;
      return [];
    });

    const gate = new DedupGate(store);
    await gate.isDuplicate("content", "my-special-tenant");
    expect(capturedTenantId).toBe("my-special-tenant");
  });

  test("constructor threshold can be overridden per call", async () => {
    const store = mockStoreWithSearch(() => [{
      entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" },
      score: 0.85,
      rankSource: "vector",
    }]);

    // Default threshold 0.92 -> score 0.85 is not duplicate
    const gate = new DedupGate(store, 0.92);
    expect(await gate.isDuplicate("x", "t1")).toBe(false);

    // Override threshold to 0.80 -> score 0.85 IS duplicate
    expect(await gate.isDuplicate("x", "t1", 0.80)).toBe(true);
  });

  test("always requests limit: 1 from store", async () => {
    let capturedLimit: number | undefined;
    const store = mockStoreWithSearch((q) => {
      capturedLimit = q.limit;
      return [];
    });

    const gate = new DedupGate(store);
    await gate.isDuplicate("any content", "t1");
    expect(capturedLimit).toBe(1);
  });

  test("passes threshold to store.search query", async () => {
    let capturedThreshold: number | undefined;
    const store = mockStoreWithSearch((q) => {
      capturedThreshold = q.threshold;
      return [];
    });

    const gate = new DedupGate(store, 0.92);
    await gate.isDuplicate("x", "t1", 0.75);
    expect(capturedThreshold).toBe(0.75);
  });

  test("handles multiple results from search (only checks first)", async () => {
    const store = mockStoreWithSearch(() => [
      { entry: { id: "e1", tenantId: "t1", category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" }, score: 0.95, rankSource: "vector" as const },
      { entry: { id: "e2", tenantId: "t1", category: "fact", content: "y", source: "s", createdAt: "2024-01-01T00:00:00Z" }, score: 0.80, rankSource: "vector" as const },
    ]);

    const gate = new DedupGate(store);
    // First result is 0.95 >= 0.92, so it's a duplicate
    expect(await gate.isDuplicate("x", "t1")).toBe(true);
  });

  test("concurrent isDuplicate calls don't interfere", async () => {
    let callCount = 0;
    const store = mockStoreWithSearch((q) => {
      callCount++;
      if (q.query === "duplicate") {
        return [{ entry: { id: "e1", tenantId: q.tenantId, category: "fact", content: "x", source: "s", createdAt: "2024-01-01T00:00:00Z" }, score: 0.95, rankSource: "vector" as const }];
      }
      return [];
    });

    const gate = new DedupGate(store);
    const results = await Promise.all([
      gate.isDuplicate("duplicate", "t1"),
      gate.isDuplicate("novel", "t1"),
      gate.isDuplicate("duplicate", "t2"),
      gate.isDuplicate("novel", "t2"),
    ]);

    expect(results).toEqual([true, false, true, false]);
    expect(callCount).toBe(4);
  });
});
