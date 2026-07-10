# Code-Check Candidates

Failures found during [test-plan.md](test-plan.md) that are objectively checkable and don't need an LLM judge. Per the eval methodology's fix-first ordering, these are tier (b) — nominated after a failure persists past an obvious prompt/tool/routing fix, and before considering an LLM judge.

Nothing is implemented yet — this is a running list populated during the first manual pass. Once a handful of these exist and are worth automating, they become simple pass/fail checks run against the `traces.jsonl` records (see `evals/trace-capture.ts` for the record shape) — no need for a full eval framework at this scale.

Format: one row per candidate, referencing the trace file(s) that surfaced it.

| Failure mode | Check | Example trace(s) | Status |
|---|---|---|---|
| _(none yet — populate during test-plan.md synthesis)_ | | | |

## Starter candidates anticipated by the plan (not yet confirmed against real traces)

These are educated guesses from the department skill specs, listed here so they're not lost — confirm or discard once real failures are observed. Do not treat this section as validated; move a row into the table above only after it's actually seen in a trace.

- Outreach copy (growth) — reject if word count > 150
- Lead list (growth) — reject if fewer than 10 leads returned
- Runbook (engops) — reject if no `## Rollback` section present
- PRD (product) — reject if no `## Non-Goals` section present
- Any task — reject if `llmCallsUsed >= llmCallsBudget` and status is not `escalated` (budget guard bypass — P0 if ever seen)
- Multi-step message (G3/P3/E3 tuples) — flag if architect task has zero child tasks (decomposition didn't happen)
- Slack-sourced task — flag if `task_completed`/`task_escalated` fired but no corresponding Slack reply was observed within N minutes
