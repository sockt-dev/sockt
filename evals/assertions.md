# Code-Check Candidates

Failures found during [test-plan.md](test-plan.md) that are objectively checkable and don't need an LLM judge. Per the eval methodology's fix-first ordering, these are tier (b) — nominated after a failure persists past an obvious prompt/tool/routing fix, and before considering an LLM judge.

Nothing is implemented yet — this is a running list populated during the first manual pass. Once a handful of these exist and are worth automating, they become simple pass/fail checks run against the `traces.jsonl` records (see `evals/trace-capture.ts` for the record shape) — no need for a full eval framework at this scale.

Format: one row per candidate, referencing the trace file(s) that surfaced it.

| Failure mode | Check | Example trace(s) | Status |
|---|---|---|---|
| Outreach copy (growth) — over word limit | reject if word count > 150 | G2 (~220 words) | Confirmed |
| PRD (product) — missing Non-Goals | reject if no `## Non-Goals` section present | P1 (missing Problem/Users/Goals/Non-Goals/Acceptance-Criteria entirely) | Confirmed |
| Runbook (engops) — missing Rollback | reject if no `## Rollback` section present | E1 (zero mentions of "rollback" anywhere in the trace) | Confirmed |
| Any task — budget guard bypass | reject if `llmCallsUsed >= llmCallsBudget` and status is not `escalated` | Not observed this pass — every near-budget-exhaustion task did correctly transition to `escalated` or `completed` via the runner's max-attempts logic; keep as a watch item, not yet a confirmed failure | Not yet observed |
| Multi-step message — no decomposition | flag if architect task has zero child tasks | G3, P3, E3 — **3/3 multi-step rows, 100% failure rate** | Confirmed, systemic |
| Slack-sourced task — no matching reply | flag if `task_completed`/`task_escalated` fired but no Slack reply observed within N minutes | Not observed as a failure — reply-telemetry consistently posted a reply for every task across the whole pass. The real reply-side issues found were different: duplicate replies (see below) and replies that are unformatted walls of raw agent narration | Not observed (this specific form) |
| New: duplicate task per Slack message | flag if two tasks are created with the same tenantId within a few hundred ms of each other from `source: "message"` telemetry, no idempotency key on inbound `event.ts` | Nearly every row (G1-G5, P1-P5 except one, E1-E6, R1/R3/R4) — the single highest-frequency defect of the whole pass | Confirmed, systemic |
| New: capability hallucination | flag output text matching action-completion phrasing ("sent", "restarted", "authenticated", "tested successfully", "connection established") when no corresponding tool call for that capability exists in the trace | G2, G5, P5, E1, E4, E5, E6 | **Implemented** — `evals/check.ts` (offline) + `packages/runtime/src/skills/hallucination-check.ts` (inline, gates `SKILL_COMPILE_ENABLED`) |
| New: tool name never matches registry | flag any `[act]` step whose `tool` field is non-null and non-empty but doesn't match a registered tool name | Present in nearly every trace (e.g. E4's "Python" instead of `exec_code`) | **Implemented** — `evals/check.ts`; re-run against the real accumulated `traces.jsonl` (160 records) and confirmed to still correctly flag all 652 violations in the pre-fix traces, zero false positives on anything traced since |
| New: edited Slack message creates a second task | flag if a task is created from an `event.ts` that Slack marks as an edit of a previously-seen message | M2 probe (`019f520b-8f39-77a2-ae3f-3b9f5008764b`) | Confirmed, and the underlying bug is now fixed (2026-07-12) — see test-plan.md |

## Status since this pass (2026-07-12)

The root causes behind several rows above were fixed directly rather than turned into a permanent code-check — see [test-plan.md](test-plan.md)'s "Status update" section for the fixes. Two of the checks above are now actually implemented as regression guards (not just nominated), since a future prompt/model change could reintroduce either failure mode silently even with the current fixes in place:

- **Tool name never matches registry** — much less likely to recur (plan.ts grounds and drops invalid names before they reach `act.ts`), but `evals/check.ts` checks it anyway against `traces.jsonl` for any `act`-phase step with a non-registered tool name.
- **New: capability hallucination** — not fixed by tool-grounding alone (the model can still narrate a false success even when its plan correctly names a real tool it just didn't call). Now checked two ways: offline via `evals/check.ts`, and inline via `hasUnbackedCapabilityClaim()` gating skill compilation. Both are regex pattern checks, not the LLM judge originally nominated below — a judge would still catch hallucinations this pattern misses (e.g. a claim that doesn't use one of the matched phrases, or a subtler misrepresentation of what a real tool call actually returned).

## Starter candidates anticipated by the plan (not yet confirmed against real traces)

These are educated guesses from the department skill specs, listed here so they're not lost — confirm or discard once real failures are observed. Do not treat this section as validated; move a row into the table above only after it's actually seen in a trace.

- Outreach copy (growth) — reject if word count > 150
- Lead list (growth) — reject if fewer than 10 leads returned
- Runbook (engops) — reject if no `## Rollback` section present
- PRD (product) — reject if no `## Non-Goals` section present
- Any task — reject if `llmCallsUsed >= llmCallsBudget` and status is not `escalated` (budget guard bypass — P0 if ever seen)
- Multi-step message (G3/P3/E3 tuples) — flag if architect task has zero child tasks (decomposition didn't happen)
- Slack-sourced task — flag if `task_completed`/`task_escalated` fired but no corresponding Slack reply was observed within N minutes
