import { test, expect, describe } from "bun:test";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import { runOutputGate, collectArtifacts } from "../verification/output-gate.ts";
import { collectToolEvidence } from "../verification/evidence.ts";
import { isImplementedCheckType, runCheck } from "../verification/checks.ts";
import type { SkillFile, Task } from "../types.ts";

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    tenantId: "t1",
    status: "in_progress",
    owner: "agent-1",
    parentId: null,
    description: "test",
    output: null,
    llmCallsUsed: 0,
    llmCallsBudget: 25,
    attemptCount: 0,
    maxAttempts: 3,
    targetDepartment: null,
    targetRole: null,
    targetSkill: null,
    afterId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

function traceWithWriteFile(content: string): ExecutionTrace {
  const trace = new ExecutionTrace("task-1", "agent-1");
  trace.addStep({
    phase: "act",
    action: "save",
    toolCall: { id: "1", name: "write_file", arguments: { filename: "out.md", content } },
    output: { written: "out.md" },
    durationMs: 0,
    timestamp: "2026-01-01T00:00:00Z",
  });
  return trace;
}

describe("checks.ts evaluators", () => {
  test("section_present passes when the heading exists with enough body", () => {
    const check = { criterion: "c", type: "section_present" as const, heading: "Rollback", minChars: 10 };
    const fullText = "## Rollback\nRun the revert script and confirm health checks pass.";
    expect(runCheck(check, { fullText, output: fullText })).toBeNull();
  });

  test("section_present fails when the heading is missing", () => {
    const check = { criterion: "c", type: "section_present" as const, heading: "Rollback", minChars: 10 };
    const result = runCheck(check, { fullText: "## Steps\ndo the thing", output: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("No \"Rollback\" section");
  });

  test("section_present fails when the section is too thin", () => {
    const check = { criterion: "c", type: "section_present" as const, heading: "Rollback", minChars: 40 };
    const result = runCheck(check, { fullText: "## Rollback\nshort\n## Next", output: "" });
    expect(result).not.toBeNull();
  });

  test("regex_present / regex_absent", () => {
    const present = { criterion: "c", type: "regex_present" as const, pattern: "\\bP[0-3]\\b" };
    expect(runCheck(present, { fullText: "This is a P1 incident.", output: "" })).toBeNull();
    expect(runCheck(present, { fullText: "severity unclear", output: "" })).not.toBeNull();

    const absent = { criterion: "c", type: "regex_absent" as const, pattern: "\\{\\{[^}]*\\}\\}" };
    expect(runCheck(absent, { fullText: "Hi there, following up.", output: "" })).toBeNull();
    expect(runCheck(absent, { fullText: "Hi {{first_name}}, following up.", output: "" })).not.toBeNull();
  });

  test("max_words whole-output limit", () => {
    const check = { criterion: "c", type: "max_words" as const, limit: 3 };
    expect(runCheck(check, { fullText: "", output: "one two three" })).toBeNull();
    const failure = runCheck(check, { fullText: "", output: "one two three four" });
    expect(failure).not.toBeNull();
    expect(failure?.detail).toContain("4 words");
  });

  test("max_words per_section scope checks each section independently", () => {
    const check = { criterion: "c", type: "max_words" as const, limit: 2, scope: "per_section" as const };
    const output = "one two\n---\nthree four five";
    const failure = runCheck(check, { fullText: "", output });
    expect(failure).not.toBeNull();
    expect(failure?.detail).toContain("section 2");
  });

  test("count_range enforces min and max", () => {
    const min = { criterion: "c", type: "count_range" as const, pattern: "lead", flags: "gi", min: 2 };
    expect(runCheck(min, { fullText: "lead one, lead two", output: "" })).toBeNull();
    expect(runCheck(min, { fullText: "lead one", output: "" })).not.toBeNull();

    const max = { criterion: "c", type: "count_range" as const, pattern: "TODO", flags: "g", max: 0 };
    expect(runCheck(max, { fullText: "no todos here", output: "" })).toBeNull();
    expect(runCheck(max, { fullText: "TODO: fix this", output: "" })).not.toBeNull();
  });

  test("isImplementedCheckType is true for every non-human_review SkillCheck type as of Phase 3", () => {
    for (const t of ["section_present", "regex_present", "regex_absent", "max_words", "count_range", "lead_provenance", "computed_number", "metric_sourcing", "grounded_quotes", "evidence_citation"] as const) {
      expect(isImplementedCheckType(t)).toBe(true);
    }
    expect(isImplementedCheckType("human_review")).toBe(false);
  });
});

describe("collectArtifacts / collectToolEvidence", () => {
  test("collectArtifacts pulls write_file content in order", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({ phase: "act", action: "a1", toolCall: { id: "1", name: "write_file", arguments: { content: "first" } }, durationMs: 0, timestamp: "" });
    trace.addStep({ phase: "act", action: "a2", toolCall: { id: "2", name: "web_search", arguments: {} }, output: {}, durationMs: 0, timestamp: "" });
    trace.addStep({ phase: "act", action: "a3", toolCall: { id: "3", name: "write_file", arguments: { content: "second" } }, durationMs: 0, timestamp: "" });
    expect(collectArtifacts(trace)).toEqual(["first", "second"]);
  });

  test("collectToolEvidence extracts URLs and numbers only from tool-backed act steps", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({
      phase: "act", action: "search", toolCall: { id: "1", name: "web_search", arguments: {} },
      output: { results: [{ url: "https://example.com/report", snippet: "revenue grew 42%" }] },
      durationMs: 0, timestamp: "",
    });
    trace.addStep({ phase: "act", action: "narrate", output: "I think it's about 100 https://fake.example.com", durationMs: 0, timestamp: "" }); // no toolCall — must not count
    const evidence = collectToolEvidence(trace);
    expect(evidence.urls.has("https://example.com/report")).toBe(true);
    expect(evidence.urls.has("https://fake.example.com")).toBe(false);
    expect(evidence.numbers.has("42")).toBe(true);
    expect(evidence.hasToolCall("web_search")).toBe(true);
    expect(evidence.hasToolCall("exec_code")).toBe(false);
  });

  test("collectToolEvidence captures exec_code stdout separately", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({
      phase: "act", action: "run", toolCall: { id: "1", name: "exec_code", arguments: {} },
      output: { exitCode: 0, stdout: "42 leads found", stderr: "" },
      durationMs: 0, timestamp: "",
    });
    const evidence = collectToolEvidence(trace);
    expect(evidence.execStdout).toBe("42 leads found");
  });
});

describe("runOutputGate", () => {
  const baseInput = { trace: new ExecutionTrace("t", "a"), skill: null as SkillFile | null, task: mockTask(), department: "growth", artifacts: [] as string[] };

  test("passes with no skill and no capability claim", () => {
    const result = runOutputGate({ ...baseInput, output: "Drafted 3 outreach variants for review." });
    expect(result.pass).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.feedback).toBe("");
  });

  test("blocks on an unbacked capability claim regardless of skill", () => {
    const result = runOutputGate({ ...baseInput, output: "Email successfully sent to the full list." });
    expect(result.pass).toBe(false);
    expect(result.blockers.some((b) => b.checkType === "capability_claim")).toBe(true);
    expect(result.feedback).toContain("FAILED mechanical verification");
  });

  test("does not block a capability claim backed by a real tool call", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({ phase: "act", action: "send", toolCall: { id: "1", name: "http_request", arguments: {} }, output: { ok: true }, durationMs: 0, timestamp: "" });
    const result = runOutputGate({ ...baseInput, trace, output: "Email successfully sent to the full list." });
    expect(result.pass).toBe(true);
  });

  const outreachSkill: SkillFile = {
    name: "outreach-copy",
    description: "d",
    steps: [],
    preconditions: [],
    successCriteria: ["Message is under 150 words for cold outreach", "One and only one CTA"],
    checks: [
      { criterion: "Message is under 150 words for cold outreach", type: "max_words", limit: 5 },
      { criterion: "One and only one CTA", type: "human_review" },
    ],
    compiledFrom: "test",
    compiledAt: "2026-01-01T00:00:00Z",
  };

  test("a failing block-severity skill check fails the gate with actionable feedback", () => {
    const result = runOutputGate({ ...baseInput, skill: outreachSkill, output: "This message has way more than five words in it." });
    expect(result.pass).toBe(false);
    expect(result.blockers[0]?.criterion).toBe("Message is under 150 words for cold outreach");
    expect(result.feedback).toContain("Message is under 150 words");
  });

  test("human_review checks never block and land in humanReview", () => {
    const result = runOutputGate({ ...baseInput, skill: outreachSkill, output: "Short." });
    expect(result.pass).toBe(true);
    expect(result.humanReview).toContain("One and only one CTA");
  });

  test("a successCriteria entry with no matching check falls into humanReview", () => {
    const skill: SkillFile = { ...outreachSkill, successCriteria: [...outreachSkill.successCriteria, "No feature-dumping"], checks: outreachSkill.checks };
    const result = runOutputGate({ ...baseInput, skill, output: "Short." });
    expect(result.humanReview).toContain("No feature-dumping");
  });

  test("evidence_citation (implemented as of Phase 3) actually runs rather than degrading to humanReview", () => {
    const skill: SkillFile = {
      ...outreachSkill,
      successCriteria: ["Root cause identified with supporting evidence"],
      checks: [{ criterion: "Root cause identified with supporting evidence", type: "evidence_citation", claimPattern: "root cause", minOverlapTokens: 4 }],
    };
    // "Short." contains no "root cause" claim, so the check has nothing to
    // flag — passes cleanly, and (unlike Phase 2's placeholder behavior)
    // does NOT land in humanReview, since it was actually evaluated.
    const result = runOutputGate({ ...baseInput, skill, output: "Short." });
    expect(result.pass).toBe(true);
    expect(result.humanReview).not.toContain("Root cause identified with supporting evidence");
  });

  test("severity:warn failures do not block but do appear in warnings and the review footer", () => {
    const skill: SkillFile = {
      name: "s", description: "d", steps: [], preconditions: [],
      successCriteria: ["has baseline/target"],
      checks: [{ criterion: "has baseline/target", type: "regex_present", pattern: "baseline", severity: "warn" }],
      compiledFrom: "test", compiledAt: "2026-01-01T00:00:00Z",
    };
    const result = runOutputGate({ ...baseInput, skill, output: "No metrics mentioned here." });
    expect(result.pass).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.annotatedOutput).toContain("Unverified (needs human review)");
    expect(result.annotatedOutput).toContain("has baseline/target");
  });

  test("annotatedOutput has no footer when everything passes cleanly", () => {
    const skill: SkillFile = {
      name: "s", description: "d", steps: [], preconditions: [],
      successCriteria: ["short message"],
      checks: [{ criterion: "short message", type: "max_words", limit: 100 }],
      compiledFrom: "test", compiledAt: "2026-01-01T00:00:00Z",
    };
    const result = runOutputGate({ ...baseInput, skill, output: "All good here." });
    expect(result.annotatedOutput).toBe("All good here.");
  });

  test("collects artifacts via write_file and runs structural checks against output+artifacts", () => {
    const trace = traceWithWriteFile("## Rollback\nRun the revert script, then verify health checks pass on all replicas.");
    const skill: SkillFile = {
      name: "runbook-writer", description: "d", steps: [], preconditions: [],
      successCriteria: ["Rollback section is complete"],
      checks: [{ criterion: "Rollback section is complete", type: "section_present", heading: "Rollback", minChars: 20 }],
      compiledFrom: "test", compiledAt: "2026-01-01T00:00:00Z",
    };
    const result = runOutputGate({ ...baseInput, trace, skill, artifacts: collectArtifacts(trace), output: "Runbook saved to file." });
    expect(result.pass).toBe(true);
  });

  test("product department gets the metric-sourcing built-in regardless of skill", () => {
    const result = runOutputGate({ ...baseInput, department: "product", skill: null, output: "Conversion rate is 42%. Great progress." });
    expect(result.pass).toBe(false);
    expect(result.blockers.some((b) => b.checkType === "metric_sourcing")).toBe(true);
  });

  test("the metric-sourcing built-in does not fire for non-product departments", () => {
    const result = runOutputGate({ ...baseInput, department: "growth", skill: null, output: "Conversion rate is 42%. Great progress." });
    expect(result.pass).toBe(true);
  });

  test("product metric-sourcing built-in passes when the number is backed by a real tool result", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({
      phase: "act", action: "search", toolCall: { id: "1", name: "web_search", arguments: {} },
      output: { results: [{ snippet: "conversion rate hit 42% last week" }] },
      durationMs: 0, timestamp: "",
    });
    const result = runOutputGate({ ...baseInput, trace, department: "product", skill: null, output: "Conversion rate is 42%." });
    expect(result.pass).toBe(true);
  });
});
