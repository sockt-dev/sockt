# Product Department — Skill Index

Skills sourced from: MMEHDI0606/ai-agent-foundation-template + npx skills registry

---

## Available Skills

### 1. `product-manager`
**When to use:** Strategy, prioritisation, roadmapping, SaaS metrics analysis
**What it does:** Apply 30+ PM frameworks — RICE, MoSCoW, JTBD, Kano, Opportunity Solution Trees
**Key metrics:** MRR, ARR, Churn, LTV, CAC, LTV:CAC ratio, NRR, Quick Ratio, Rule of 40
**Output:** Prioritised roadmap, framework-backed decisions, metric dashboards

### 2. `spec-writing`
**When to use:** Task involves writing a PRD, feature spec, technical requirement doc
**What it does:** Structured spec writing — Problem, Users, Goals, Requirements, ACs, Out of Scope
**Rules:** 1 page max for features, 3 pages max for epics, every requirement must be testable
**Output:** Complete PRD with success metrics, ACs, non-goals

### 3. `user-research`
**When to use:** Task involves synthesising feedback, interviews, support tickets, NPS data
**What it does:** JTBD statements, pain point prioritisation, persona updates from research
**Framework:** Jobs-to-be-Done: "When [situation] I want to [motivation] So I can [outcome]"
**Output:** Research report with JTBD statements, pain point priority matrix, product implications

### 4. `github-issues`
**When to use:** Task involves creating GitHub issues from a spec or feature breakdown
**What it does:** Well-structured issues: title, user story, acceptance criteria, labels, tech notes
**Format:** Conventional commit titles, Given/When/Then ACs, p0/p1/p2 priority labels
**Output:** Issue list or direct GitHub API calls to create issues

---

## Skill Selection Guide

| Task keywords | Use skill |
|---------------|-----------|
| priority, roadmap, RICE, strategy, what to build next | `product-manager` |
| PRD, spec, requirements, feature doc, one-pager | `spec-writing` |
| user feedback, interviews, insights, JTBD, persona | `user-research` |
| GitHub issue, ticket, task, backlog item, story | `github-issues` |

---

## Sources

- `Digidai/product-manager-skills@product-manager` (PM frameworks)
- `rshankras/claude-code-apple-skills@product-development` (356 installs)
- `davila7/claude-code-templates@ai-product` (394 installs)
- `neolabhq/context-engineering-kit@attach-review-to-pr` (737 installs)
- `MMEHDI0606/ai-agent-foundation-template` (product-design, product-inventor, linear-automation)
