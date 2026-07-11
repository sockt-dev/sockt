# Engineering Operations Department — Skill Index

Skills sourced from: MMEHDI0606/ai-agent-foundation-template + npx skills registry

---

## Available Skills

### 1. `incident-responder`
**When to use:** Any production incident, outage, degradation, or alert that needs triage
**What it does:** SRE-grade incident response — severity classification, stabilisation, investigation, post-mortem
**Severity:** P0 (<15min ack, <1hr resolve), P1 (<1hr, <4hr), P2 (<4hr, <24hr), P3 (next day)
**Output:** Severity classification, status update, root cause, blameless post-mortem

### 2. `runbook-writer`
**When to use:** Task involves documenting a recurring operational procedure
**What it does:** Write comprehensive runbooks: Trigger → Prerequisites → Steps → Validation → Rollback → Escalation
**Rule:** Never publish a runbook without a tested rollback section
**Output:** Complete runbook that a junior on-call engineer can execute alone

### 3. `deployment-engineer`
**When to use:** Task involves planning, executing, or reviewing a production deployment
**What it does:** Strategy selection (canary/blue-green/rolling), pre-deploy gate, SLI monitoring, smoke tests
**Uses:** `exec_code` for deployment scripts in Docker AI Sandbox isolation
**Output:** Deployment plan, execution log, SLI comparison, smoke test results

### 4. `devops-troubleshooter`
**When to use:** Production issue with unknown cause, debugging a system behaviour
**What it does:** Change correlation, SLI analysis, distributed trace inspection, log analysis
**Method:** USE (Utilisation, Saturation, Errors) for infra; RED (Rate, Errors, Duration) for services
**Output:** Root cause with evidence from ≥2 data sources, debug summary, prevention measure

---

## Skill Selection Guide

| Task keywords | Use skill |
|---------------|-----------|
| incident, outage, down, alert, P0, P1, degraded | `incident-responder` |
| runbook, playbook, procedure, on-call, SOP | `runbook-writer` |
| deploy, release, rollout, canary, rollback, pipeline | `deployment-engineer` |
| debug, investigate, slow, error, cause, trace, log | `devops-troubleshooter` |

---

## Escalation Rules (Always to Humans)

- **Security breach** or suspected data exfiltration → immediate human escalation
- **Data loss** or database corruption → do not attempt automated fix
- **Payment system** failures → Stripe/payment team + human IC
- **P0 > 30 min unresolved** → escalate to on-call manager

---

## Sources

- `community/incident-responder` (SRE incident management)
- `aj-geddes/useful-ai-prompts@runbook-creation` (386 installs)
- `404kidwiz/claude-supercode-skills@devops-incident-responder` (105 installs)
- `vasilyu1983/ai-agents-public@ops-devops-platform` (153 installs)
- `MMEHDI0606/ai-agent-foundation-template` (deployment-engineer, devops-troubleshooter, sentry-automation, pagerduty-automation)

## Evaluated, not added (2026-07-12)

Two Claude Code plugin marketplaces were reviewed for this department alongside the growth/product additions (see growth/SKILLS_INDEX.md and product/SKILLS_INDEX.md) and deliberately left out:

- **`JuliusBrussee/caveman`** — compressed code-review comments, commit messages, and context-compression tooling for a human using Claude Code interactively. This is a coding-workflow aid for a developer, not an ops/incident/deployment skill an engops agent would execute as a task step — doesn't match this department's actual scope (production incidents, runbooks, deployments).
- **`fuuuuuuma/ai-second-brain-kit`** — builds a persistent Obsidian-vault "second brain" for a human's own Claude Code sessions. Conceptually adjacent to Sockt's own CADVP/GBrain memory pipeline (see [docs/ARCHITECTURE.md](../../../../../../docs/ARCHITECTURE.md#memory-pipeline-cadvp--gbrain)), but that's infrastructure Sockt already has for its agents — not a department task skill.
