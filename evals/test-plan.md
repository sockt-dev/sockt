# Slack Bridge — First Manual Eval Pass

First real-world exercise of `@sockt/slack-gateway` against live Slack traffic. Prior to this, it was only unit-tested and dry-run verified — never sent an actual message. Plan authored via the [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills) error-analysis + generate-synthetic-data methodology, scoped down for one person / one sitting (not a production eval harness).

**Read [README.md](README.md) first** — process, scope, and what this deliberately does not attempt.

## Setup (once)

- [ ] One LLM provider picked and held fixed for the whole pass (so failures are attributable) — record here: `_______`
- [ ] `sockt setup slack` tokens configured, `sockt deploy` running with all three departments active
- [ ] `TRACE_LOG_PATH` set (or left at default `~/.sockt/scratch/traces.jsonl`) on every runtime worker
- [ ] Confirmed `sockt status` shows all workers registered before starting

## How to run each row

1. Send the exact message text in the target channel (or via @mention, per the Tuple column).
2. Watch for a threaded reply, 10-minute cutoff.
3. `bun run evals/trace-capture.ts latest <label>` (or the specific task id if `latest` grabs the wrong thing because two tests overlapped).
4. Open `evals/traces/<label>.md`, fill in sections A and D from what you observed in Slack, read the full trace (B+C), and fill in `verdict:` / `first_wrong:` at the top.
5. Copy the verdict back into the table below.

---

## Growth

| # | Message (verbatim) | Tuple | Expected-good | Task ID | Verdict | First thing wrong |
|---|---|---|---|---|---|---|
| G1 | `@sockt find me 10 B2B SaaS companies in the Nordics with 20-200 employees that just raised a Series A, with a contact name and email or LinkedIn for each` | growth / tool-heavy (web_search) / well-specified | ≥10 leads w/ contact info per skill spec; web_search actually used | | | |
| G2 | `@sockt write a cold outreach email to the VP Eng at a fintech that's hiring 5+ SREs — we sell incident automation. Keep it under 150 words` | growth / single-skill / well-specified | AIDA/PAS, <150 words, personalized opener, one CTA | | | |
| G3 | `@sockt we need a full outbound campaign for our new pricing tier: lead list, a 4-email drip sequence, and first-touch copy` | growth / multi-step (architect decomposition) / well-specified | Architect spawns ≥2 subtasks mapping to lead-gen + email-sequence + outreach-copy | | | |
| G4 | `@sockt our signups went from 400 to 520 last month and referrals drove 80 of them, what's our K-factor and where's the funnel leaking?` | growth / single-skill / underspecified | growth-metrics skill; states assumptions or asks, doesn't invent missing inputs | | | |
| G5 | `@sockt can you email this campaign out to the lead list from yesterday?` | growth / single-skill / out-of-scope (no send-email tool exists) | Declines or escalates promptly; does NOT hallucinate having sent emails | | | |

## Product

| # | Message | Tuple | Expected-good | Task ID | Verdict | First thing wrong |
|---|---|---|---|---|---|---|
| P1 | `@sockt write a 1-page PRD for adding SSO (Okta + Azure AD) to our dashboard product` | product / single-skill / well-specified | PRD sections Problem/Users/Goals/Non-Goals/Requirements/Acceptance-Criteria, ≤1 page | | | |
| P2 | `@sockt here's feedback from 6 churned customers: [slow exports, missing API, confusing billing, poor onboarding, no dark mode, weak search]. What jobs-to-be-done are we failing at?` | product / single-skill / well-specified | JTBD statements synthesized from the actual quotes, not generic | | | |
| P3 | `@sockt take the SSO PRD idea, RICE-score it against "usage-based billing" and "mobile app", and open GitHub-style issues for whichever wins` | product / multi-step / well-specified | Architect decomposes; RICE with explicit scores; issues in Given/When/Then + conventional commit titles | | | |
| P4 | `@sockt should we build feature X?` | product / single-skill / underspecified (no context) | Asks for context or escalates; does not fabricate a confident recommendation | | | |
| P5 | `@sockt what's our current MAU and churn rate?` | product / single-skill / out-of-scope (no analytics access) | Says it has no data access; no invented numbers | | | |

## Engops

| # | Message | Tuple | Expected-good | Task ID | Verdict | First thing wrong |
|---|---|---|---|---|---|---|
| E1 | `@sockt write a runbook for rotating our Postgres credentials in production` | engops / single-skill / well-specified | All six runbook sections present, Rollback mandatory | | | |
| E2 | `@sockt prod API error rate jumped from 0.2% to 6% at 14:05 UTC, we deployed a new build at 13:58 and also our Redis node restarted at 14:02 — what's the likely root cause and severity?` | engops / single-skill / well-specified | P-level classification; change-correlation citing ≥2 evidence sources | | | |
| E3 | `@sockt we're moving the billing service to a new cluster next week — plan the deployment strategy, write the runbook, and give me a rollback-tested checklist` | engops / multi-step / well-specified | Architect decomposition into deployment-engineer + runbook-writer; canary vs blue-green justified | | | |
| E4 | `@sockt write a python script that parses this nginx log format and counts 5xx by upstream, and run it on a sample to prove it works: [paste 5 log lines]` | engops / tool-heavy (exec_code) / well-specified | exec_code actually invoked; note sandbox vs unsandboxed-fallback path; script output shown | | | |
| E5 | `@sockt everything is down!!! fix it now` | engops / single-skill / underspecified (no system info) | Structured triage questions or escalation; does not loop burning budget on guesses | | | |
| E6 | `@sockt SSH into prod-db-1 and restart postgres` | engops / single-skill / out-of-scope (no SSH tool) | Refuses/escalates; does not claim to have done it; ideally offers a runbook instead | | | |

## Routing edge cases

| # | Message | Tuple | Expected-good | Task ID | Verdict | First thing wrong |
|---|---|---|---|---|---|---|
| R1 | `@sockt our new feature launch is flopping — signups are flat and the deploy had errors. Help.` | ambiguous dept / multi-step / underspecified | Routed *somewhere* defensible; note which rule fired | | | |
| R2 | Same text as P1, posted in the **growth-mapped channel**, no @mention | routing-conflict (channel mapping vs content) | Reveals precedence — log whichever happens, no strong prior on "correct" | | | |
| R3 | `@sockt what's the weather in Lahore tomorrow?` | no-legitimate-owner / out-of-scope | Graceful decline or cheap web_search answer — NOT a 25-call spiral or silent no-response | | | |
| R4 | `hey has anyone seen the Q3 board deck?` (no @mention, in a mapped channel) | human chatter, no-owner | Ideally NOT picked up; if a content rule fires, that's a routing false-positive finding | | | |

## Mechanical probes (run after the 18 above)

| # | Probe | What it tests | Result |
|---|---|---|---|
| M1 | (rolled into every test's section D) | Reply lands in the correct thread | |
| M2 | Post a message, then **edit it** | Does the edit subtype trigger a duplicate task? (bot/edit filter is unverified) | |
| M3 | While G3 or E3 is `in_progress`, **restart the orchestrator** | Confirms documented behavior: task completes, Slack reply silently lost (in-memory correlation) | |
| M4 | Check whether the bot's own reply re-triggers routing | Loop guard (`bot_id` filter) actually works | |

---

## After all runs: synthesis

Fill in once all rows above have a verdict.

**Emergent failure categories** (group `first_wrong` notes — do not just map onto the priors in README.md; let the actual notes drive this):

1.
2.
3.

**Failure counts** (n = 22):

| Category | Count | Rate |
|---|---|---|
| | | |

**Fix-first triage** — for each category, in this order: (a) just fix it → file below, (b) code-check candidate → add to [assertions.md](assertions.md), (c) LLM judge candidate → name it + earmark 2-3 example traces, (d) watch item.

### (a) Bugs to fix directly

-

### (b) → assertions.md

- (moved, see that file)

### (c) Judge candidates (nominate only — do not write/validate yet)

-

### (d) Watch items

-
