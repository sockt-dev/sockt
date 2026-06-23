import { test, expect, describe } from "bun:test";
import { createMemoryStore, GBrainMcpClient } from "../index.ts";

describe("createMemoryStore", () => {
  test("returns a GBrainMcpClient instance", () => {
    const store = createMemoryStore({ endpoint: "http://localhost:3100" });
    expect(store).toBeInstanceOf(GBrainMcpClient);
  });

  test("returned object has all MemoryStore methods", () => {
    const store = createMemoryStore({ endpoint: "http://localhost:3100" });

    expect(typeof store.write).toBe("function");
    expect(typeof store.search).toBe("function");
    expect(typeof store.deduplicateCheck).toBe("function");
    expect(typeof store.commit).toBe("function");
    expect(typeof store.listCategories).toBe("function");
    expect(typeof store.delete).toBe("function");
  });

  test("passes config to client", async () => {
    const store = createMemoryStore({
      endpoint: "http://127.0.0.1:1",
      timeoutMs: 50,
      retries: 0,
    }) as GBrainMcpClient;

    // ping should fail fast with these settings
    const healthy = await store.ping();
    expect(healthy).toBe(false);
  });
});
