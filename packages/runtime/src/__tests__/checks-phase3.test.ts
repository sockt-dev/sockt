import { test, expect, describe } from "bun:test";
import { runCheck, isImplementedCheckType, findUnsourcedMetricClaim } from "../verification/checks.ts";
import { collectToolEvidence } from "../verification/evidence.ts";
import { ExecutionTrace } from "../trace/execution-trace.ts";
import type { ToolEvidence } from "../verification/evidence.ts";

function emptyEvidence(overrides: Partial<ToolEvidence> = {}): ToolEvidence {
  return {
    urls: new Set(),
    numbers: new Set(),
    text: "",
    execStdout: "",
    hasToolCall: () => false,
    ...overrides,
  };
}

describe("lead_provenance", () => {
  const check = { criterion: "c", type: "lead_provenance" as const };

  test("passes when every lead row's URL or email domain is backed by real tool evidence", () => {
    const fullText = "| Jane Doe | Acme Inc | https://linkedin.com/in/janedoe |\n| John Smith | Widget Co | john@widgetco.com |";
    const evidence = emptyEvidence({
      urls: new Set(["https://linkedin.com/in/janedoe"]),
      text: "contact john@widgetco.com for details",
      hasToolCall: (n) => n === "web_search",
    });
    const result = runCheck(check, { fullText, output: "", evidence, taskDescription: "" });
    expect(result).toBeNull();
  });

  test("fails when a lead row has no backing URL or email domain", () => {
    const fullText = "| Jane Doe | Acme Inc | https://linkedin.com/in/janedoe |\n| Fake Person | Nowhere LLC | fake@nowhere-domain.com |";
    const evidence = emptyEvidence({
      urls: new Set(["https://linkedin.com/in/janedoe"]),
      text: "linkedin.com/in/janedoe found via search",
      hasToolCall: (n) => n === "web_search",
    });
    const result = runCheck(check, { fullText, output: "", evidence, taskDescription: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("Fake Person");
  });

  test("fails outright when there are no lead rows at all", () => {
    const result = runCheck(check, { fullText: "No leads found today.", output: "", evidence: emptyEvidence(), taskDescription: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("No lead rows found");
  });

  test("fails when no search tool was ever called, even with well-formed rows", () => {
    const fullText = "| Jane Doe | Acme Inc | jane@acme.com |";
    const result = runCheck(check, { fullText, output: "", evidence: emptyEvidence(), taskDescription: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("No web_search/http_request results");
  });
});

describe("computed_number", () => {
  const check = { criterion: "c", type: "computed_number" as const, labelPattern: "k[- ]?factor" };

  test("passes silently when the label was never claimed", () => {
    const result = runCheck(check, { fullText: "No metrics computed here.", output: "", evidence: emptyEvidence(), taskDescription: "" });
    expect(result).toBeNull();
  });

  test("fails when the number was stated without any exec_code call", () => {
    const result = runCheck(check, { fullText: "K-factor is 0.42.", output: "", evidence: emptyEvidence(), taskDescription: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("without computing it");
  });

  test("passes when exec_code ran and its stdout contains a matching number", () => {
    const evidence = emptyEvidence({ execStdout: "k_factor = 0.42\n", hasToolCall: (n) => n === "exec_code" });
    const result = runCheck(check, { fullText: "K-factor is 0.42.", output: "", evidence, taskDescription: "" });
    expect(result).toBeNull();
  });

  test("fails when exec_code ran but the stated number doesn't match its output", () => {
    const evidence = emptyEvidence({ execStdout: "k_factor = 0.10\n", hasToolCall: (n) => n === "exec_code" });
    const result = runCheck(check, { fullText: "K-factor is 0.42.", output: "", evidence, taskDescription: "" });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("does not match");
  });
});

describe("metric_sourcing / findUnsourcedMetricClaim", () => {
  test("flags a metric claim with no tool-backed number and no ASSUMPTION label", () => {
    const failure = findUnsourcedMetricClaim("Conversion rate is 42%. That's a strong signal.", emptyEvidence(), "");
    expect(failure).not.toBeNull();
    expect(failure?.detail).toContain("42%");
  });

  test("passes when the number is backed by tool evidence", () => {
    const evidence = emptyEvidence({ numbers: new Set(["42"]) });
    const failure = findUnsourcedMetricClaim("Conversion rate is 42%.", evidence, "");
    expect(failure).toBeNull();
  });

  test("passes when the number appears in the task's own description", () => {
    const failure = findUnsourcedMetricClaim("Conversion rate is 42%.", emptyEvidence(), "Current conversion rate is 42% per last week's dashboard.");
    expect(failure).toBeNull();
  });

  test("passes when explicitly labeled as an assumption", () => {
    const failure = findUnsourcedMetricClaim("ASSUMPTION: conversion rate is roughly 42%.", emptyEvidence(), "");
    expect(failure).toBeNull();
  });

  test("passes output with no metric-shaped claims at all", () => {
    const failure = findUnsourcedMetricClaim("We should focus on retention next quarter.", emptyEvidence(), "");
    expect(failure).toBeNull();
  });
});

describe("grounded_quotes", () => {
  const check = { criterion: "c", type: "grounded_quotes" as const, minQuotes: 2 };

  test("downgrades to a warning when the input has no verbatim feedback to ground against", () => {
    const result = runCheck(check, { fullText: "Users seem happy overall.", output: "Users seem happy overall.", evidence: emptyEvidence(), taskDescription: "Summarize general sentiment." });
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("warn");
  });

  test("fails when input has quotes but the output doesn't reference them", () => {
    const taskDescription = '"I really wish the onboarding was faster" and "the pricing page confused me a lot" were common complaints.';
    const result = runCheck(check, { fullText: "Users are generally satisfied with the product.", output: "Users are generally satisfied with the product.", evidence: emptyEvidence(), taskDescription });
    expect(result).not.toBeNull();
    expect(result?.severity).toBeUndefined();
  });

  test("passes when the output quotes the real input feedback", () => {
    const taskDescription = '"I really wish the onboarding was faster" and "the pricing page confused me a lot" were common complaints.';
    const output = 'Users said: "I really wish the onboarding was faster" and also "the pricing page confused me a lot".';
    const result = runCheck(check, { fullText: output, output, evidence: emptyEvidence(), taskDescription });
    expect(result).toBeNull();
  });
});

describe("evidence_citation", () => {
  const check = { criterion: "c", type: "evidence_citation" as const, claimPattern: "root cause|caused by", minOverlapTokens: 3 };

  test("fails a causal claim with no supporting tokens in the input or tool evidence", () => {
    const output = "The root cause was a misconfigured firewall rule blocking outbound traffic.";
    const result = runCheck(check, { fullText: output, output, evidence: emptyEvidence(), taskDescription: "Investigate the outage." });
    expect(result).not.toBeNull();
    expect(result?.detail).toContain("root cause");
  });

  test("passes a causal claim whose content words appear in tool evidence", () => {
    const output = "The root cause was a misconfigured firewall rule blocking outbound traffic.";
    const evidence = emptyEvidence({ text: "firewall rule misconfigured blocking outbound traffic detected in logs" });
    const result = runCheck(check, { fullText: output, output, evidence, taskDescription: "" });
    expect(result).toBeNull();
  });

  test("non-causal sentences are ignored entirely", () => {
    const output = "Everything looks fine right now.";
    const result = runCheck(check, { fullText: output, output, evidence: emptyEvidence(), taskDescription: "" });
    expect(result).toBeNull();
  });
});

describe("isImplementedCheckType — Phase 3 additions", () => {
  test("all five new types are now implemented", () => {
    for (const t of ["lead_provenance", "computed_number", "metric_sourcing", "grounded_quotes", "evidence_citation"] as const) {
      expect(isImplementedCheckType(t)).toBe(true);
    }
  });

  test("human_review is still unimplemented (handled separately by output-gate.ts)", () => {
    expect(isImplementedCheckType("human_review")).toBe(false);
  });
});

describe("collectToolEvidence integration sanity", () => {
  test("a real trace's evidence flows correctly into findUnsourcedMetricClaim", () => {
    const trace = new ExecutionTrace("t", "a");
    trace.addStep({
      phase: "act", action: "search", toolCall: { id: "1", name: "web_search", arguments: {} },
      output: { results: [{ url: "https://example.com", snippet: "MRR grew to 15000 this quarter" }] },
      durationMs: 0, timestamp: "",
    });
    const evidence = collectToolEvidence(trace);
    const failure = findUnsourcedMetricClaim("MRR is now $15000.", evidence, "");
    expect(failure).toBeNull();
  });
});
