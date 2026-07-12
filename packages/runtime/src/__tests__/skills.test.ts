import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { SkillCompiler } from "../skills/compiler.ts";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import { scoreRelevance } from "../skills/matcher.ts";
import { rmSync, mkdirSync } from "node:fs";

describe("SkillCompiler", () => {
  const testDir = "/tmp/sockt-skills-test";

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("compiles a successful trace into a skill file", async () => {
    const trace = new ExecutionTrace("task-abc123", "agent-1");
    trace.addStep({
      phase: "act",
      action: "search_web",
      toolCall: { id: "tc-1", name: "web-search", arguments: { query: "bun runtime" } },
      output: "Found 5 results",
      durationMs: 100,
      timestamp: "2024-01-01T00:00:00Z",
    });
    trace.addStep({
      phase: "act",
      action: "summarize",
      toolCall: { id: "tc-2", name: "summarize", arguments: { text: "..." } },
      output: "Summary complete",
      durationMs: 200,
      timestamp: "2024-01-01T00:00:01Z",
    });
    trace.addStep({
      phase: "observe",
      action: "observe",
      durationMs: 0,
      timestamp: "2024-01-01T00:00:02Z",
    });
    trace.setOutcome({ status: "completed", output: "done" });

    const compiler = new SkillCompiler(testDir);
    const skill = await compiler.compile(trace);

    expect(skill.steps).toHaveLength(2);
    expect(skill.steps[0]!.tool).toBe("web-search");
    expect(skill.steps[1]!.tool).toBe("summarize");
    expect(skill.compiledFrom).toBe("task-abc123");
    expect(skill.name).toContain("skill-task-abc");

    const fileContent = await Bun.file(`${testDir}/${skill.name}.skill`).text();
    const parsed = JSON.parse(fileContent);
    expect(parsed.steps).toHaveLength(2);
  });

  test("findRelevant matches skills by keyword", async () => {
    const compiler = new SkillCompiler(testDir);

    const trace1 = new ExecutionTrace("task-search1", "agent-1");
    trace1.addStep({
      phase: "act",
      action: "web_search",
      toolCall: { id: "tc-1", name: "web-search", arguments: {} },
      output: "results",
      durationMs: 100,
      timestamp: "2024-01-01T00:00:00Z",
    });
    trace1.setOutcome({ status: "completed", output: "done" });
    await compiler.compile(trace1);

    const results = await compiler.findRelevant("search task", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("findRelevant returns empty for no matches", async () => {
    const compiler = new SkillCompiler(testDir);
    const results = await compiler.findRelevant("zzzzzzuniquezzzzz", 5);
    expect(results).toHaveLength(0);
  });

  test("loadByName loads a skill deterministically by exact name, no relevance scoring", async () => {
    const compiler = new SkillCompiler(testDir);
    const trace = new ExecutionTrace("task-load1", "agent-1");
    trace.addStep({ phase: "act", action: "a", toolCall: { id: "1", name: "web-search", arguments: {} }, output: "r", durationMs: 0, timestamp: "2024-01-01T00:00:00Z" });
    trace.setOutcome({ status: "completed", output: "done" });
    const compiled = await compiler.compile(trace);

    const loaded = await compiler.loadByName(compiled.name);
    expect(loaded?.name).toBe(compiled.name);
  });

  test("loadByName returns null for a missing skill instead of throwing", async () => {
    const compiler = new SkillCompiler(testDir);
    const loaded = await compiler.loadByName("does-not-exist");
    expect(loaded).toBeNull();
  });
});

describe("scoreRelevance", () => {
  test("returns 0 for completely different texts", () => {
    expect(scoreRelevance("deploy kubernetes cluster", "bake chocolate cake")).toBe(0);
  });

  test("returns positive score for overlapping words", () => {
    const score = scoreRelevance("search the web for results", "web search query results");
    expect(score).toBeGreaterThan(0);
  });

  test("returns 0 for empty strings", () => {
    expect(scoreRelevance("", "something")).toBe(0);
    expect(scoreRelevance("something", "")).toBe(0);
  });

  test("higher score for more overlap", () => {
    const low = scoreRelevance("deploy app", "search web for data");
    const high = scoreRelevance("search web results", "search web for results");
    expect(high).toBeGreaterThan(low);
  });
});
