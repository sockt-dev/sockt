# Sockt Evals — Slack Bridge First Manual Pass

First real-world exercise of `@sockt/slack-gateway` against live Slack traffic. Before this, the Slack bridge was only unit-tested and dry-run verified — never sent an actual message through a real workspace. This directory exists to catch bugs in genuinely untested code, not to stand up a production eval system.

Plan authored following the [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills) methodology (error-analysis, generate-synthetic-data, and the fix-first triage from write-judge-prompt), deliberately scoped down for one person doing a first pass in one sitting.

## Files

| File | Purpose |
|---|---|
| [test-plan.md](test-plan.md) | The 18 test messages + 4 mechanical probes, as a results-log checklist |
| [assertions.md](assertions.md) | Code-check candidates nominated during review — tier (b) in the fix-first triage below |
| `trace-capture.ts` | Pulls task state + execution trace for one task, writes a markdown trace file |
| `check.ts` | Phase 3 addition (2026-07-12) — runs the confirmed code-checks from assertions.md (tool-name-grounding, capability hallucination) over all of `traces.jsonl` as a cheap CI-friendly regression guard. `bun run evals/check.ts` |
| `traces/` | Output directory — one file per test run, git-ignored (traces may contain real Slack content) |

## What "trace" means here

One Slack message you send → everything Sockt does because of it → the final observable state. One test message = one trace, even if the architect spawns subtasks (subtasks are part of the parent trace — judgment happens at the level the user experiences: "I asked in Slack, did I get a good answer in the thread?").

A complete trace has four parts:

- **A. Trigger** — the Slack message itself (channel, thread id, exact text, which routing rule you expected to fire). Captured manually — not available from any API.
- **B. Orchestrator state** — the task row(s) from `GET /tasks/:id`, including any children created via `create_task`. **Known gap**: the orchestrator stores current status + `createdAt`/`updatedAt` only, not a full transition-by-transition history. `trace-capture.ts` reports what's actually there, not an invented timeline.
- **C. Agent execution trace** — every Plan/Act/Observe/Reflect step, every tool call, every Reflect verdict. This did not exist anywhere on disk before this eval pass — `ExecutionTrace.toJSON()` was built but never called. Fixed as part of this work: `packages/runtime/src/runner/agent-runner.ts` now appends one JSON line per finished task to `TRACE_LOG_PATH` (default `~/.sockt/scratch/traces.jsonl`). `trace-capture.ts` reads from there.
- **D. Slack outcome** — did a reply appear, in the right thread, how fast, what did it say. Observed manually; Slack API polling is out of scope for this script.

Run `bun run evals/trace-capture.ts latest <label>` right after each test message to assemble A(stub)+B+C(real data)+D(stub) into `traces/<label>.md`, then fill in the manual parts by hand.

## Process

Full checklist is in [test-plan.md](test-plan.md). Summary:

1. Send a test message, wait for a threaded reply (10-min cutoff).
2. Capture the trace (`trace-capture.ts`).
3. Read the **full trace**, not just the Slack reply — reviewing only the final output hides where the pipeline actually broke.
4. Binary Pass/Fail at trace level against the pre-written "expected-good" column. No partial credit.
5. One sentence: the **first** thing that went wrong (errors cascade — downstream symptoms disappear once the root cause is fixed, so don't chase every issue in one trace).

After all 22 runs, group the free-text notes into emergent failure categories (do not just map onto the priors below — let the data drive it), compute rough counts, and triage each category in this strict order:

1. **Just fix it** — prompt gap, missing tool, routing bug, engineering defect. Expected to be most findings, since this is never-run code.
2. **Code-based check** — objectively checkable, persists after fixes → add to [assertions.md](assertions.md).
3. **LLM judge candidate** — subjective, persistent, worth iterating on repeatedly → *nominate only*, with 2-3 example traces earmarked. Do not write or validate a judge yet (see below).
4. **Watch item** — seen once, unclear root cause, low stakes → log and move on.

## Failure category priors (not a checklist)

Informed guesses given Sockt's actual architecture, to sensitize the reviewer on a first pass through brand-new code. Expect these to be wrong in places and incomplete — per the error-analysis methodology, do not brainstorm categories before reading traces; these exist only so nothing obvious gets missed while reading.

1. **Routing misfire** — wrong department, no agent matched (message silently ignored), false-positive pickup of human chatter.
2. **Slack reply loss/misdelivery** — task completed but no reply, wrong thread/channel, duplicate replies, excessive latency.
3. **Budget pathology** — burned the full budget on an unanswerable request instead of escalating early; architect exhausted its budget mid-decomposition leaving orphaned subtasks. Any runaway that doesn't auto-escalate is a P0.
4. **Capability hallucination** — agent claims to have done something no tool supports (sent an email, SSH'd into a box, read live analytics).
5. **Skill-index non-adherence** — output ignores the department's written spec (outreach >150 words, runbook missing Rollback, PRD missing Non-Goals, <10 leads).
6. **Tool failure handled badly** — search/exec_code/http_request errors not surfaced or recovered from.
7. **Decomposition failure** — architect answers directly instead of spawning subtasks, or subtask results never get assembled into a final reply.
8. **FSM/state bugs** — task stuck pending/in_progress forever, wrong terminal state, escalation with no Slack notification.

## What this deliberately does not attempt

- **No LLM judges written or validated.** Judge few-shot examples need a training split of human-labeled traces; this pass produces ~22 total labels. Nominate candidates only.
- **No validate-evaluator work** — no train/dev/test split, no TPR/TNR, no Rogan-Gladen bias correction. That needs ~50 true-pass + ~50 true-fail labels per judge; two orders of magnitude more data than this pass produces. Measuring TPR/TNR on 22 traces would produce meaningless numbers and false confidence.
- **No push to 100-trace saturation.** This pass exists to find catastrophic bugs in new code. Re-running toward full saturation belongs after the bugs found here are fixed — error analysis gets re-run after every significant pipeline change, not extended indefinitely on a broken baseline.
- **No pre-committed failure taxonomy.** The priors above are context, not a rubric to fill in mechanically.
- **No review UI, no multi-annotator process.** One domain expert reading full traces in markdown files is the right scale here (`build-review-interface` is for teams/volume).
- **No provider matrix.** One LLM provider, held fixed for the whole pass, so failures are attributable to the pipeline and not confounded with model differences.

## Exit criteria

All 18 test messages + 4 mechanical probes run and labeled; emergent failure categories with counts; a fix-list, an assertion-spec list, and 0-3 named judge candidates with earmarked example traces. That output is the input to the *next* iteration — fix, re-run, and only then start growing toward more traces and judge validation.

## Status since this pass

The fix-first triage list from this pass has been worked through — see the **"Status update — 2026-07-12"** section at the bottom of [test-plan.md](test-plan.md) for what's been fixed, what new capability (HITL approval + clarifying questions) was built as a direct result of the capability-hallucination findings, and what the acceptance-replay plan is. The 20 scored rows and their original verdicts above are left as-recorded — this is not a re-run.
