# Departments & Skills

A **department** is a pre-configured team of agents (one architect + one or
more workers) plus a curated set of **skills** — pre-compiled execution
patterns that seed each worker's context so it doesn't have to rediscover
best practices from scratch on every task.

## Built-in Departments

| Department | Architect | Workers | Use case |
|---|---|---|---|
| `growth` | Growth Architect | Lead Researcher, Outbound Writer | Find and qualify leads, draft outreach |
| `product` | Product Architect | User Researcher, Spec Writer | Specs, roadmaps, GitHub issues |
| `engops` | Eng-Ops Architect | Incident Triager, Deploy Worker | Incidents, runbooks, deployments |

```bash
sockt department list              # see available + active departments
sockt department add growth        # activate one
sockt deploy                       # spawns architect + workers for active departments
```

> There is also a `support` template defined in
> `packages/orch/src/registry/templates/support.ts`, but it is **not yet
> wired into the CLI's department list** (`rust/sockt-cli/src/commands/department/templates.rs`
> only recognizes `growth`, `product`, `engops`) and its tools
> (`ticket-manage`, `kb-search`, `escalation-route`) aren't implemented in
> the runtime's built-in tool set. Treat it as a starting point for a
> contribution, not a working department yet.

## How a Department Is Structured

Each department template (`packages/orch/src/registry/templates/<name>.ts`)
returns an array of `AgentConfig`:

```typescript
export function growthTemplate(tenantId: string): AgentConfig[] {
  return [
    {
      id: `${tenantId}-growth-architect`,
      tenantId,
      name: "Growth Architect",
      role: "architect",              // decomposes goals into subtasks
      department: "growth",
      llmConfig: { provider: "anthropic", model: "claude-sonnet-4-6-20250514" },
      systemPrompt: `...`,             // includes coordination instructions
      tools: ["create_task"],          // architects only need this
    },
    {
      id: `${tenantId}-growth-lead-researcher`,
      role: "worker",                  // claims and executes leaf tasks
      department: "growth",
      systemPrompt: GROWTH_SYSTEM_PROMPT,  // the full skill index, see below
      tools: ["web_search", "http_request", "write_file", "read_file"],
      // ...
    },
  ];
}
```

**Architects** get only `create_task` — their job is decomposition, not
execution. **Workers** get the tools their skills actually need, plus the
full skill index embedded directly in their system prompt.

## The Skill Index Pattern

Rather than relying purely on runtime skill discovery (which only kicks in
*after* an agent has completed similar tasks before — see
[ARCHITECTURE.md](ARCHITECTURE.md#memory-pipeline-cadvp--gbrain)), each
department worker's system prompt embeds a **written skill index**: for each
skill, when to use it, the exact workflow steps, and what "done" looks like.
This means a fresh deployment with zero task history still produces
structured, high-quality output on day one.

Example excerpt from the growth department's worker prompt
(`packages/orch/src/registry/templates/growth.ts`):

```
### 1. lead-generation
USE WHEN: finding prospects, building contact lists, sourcing leads, scraping companies
WORKFLOW:
1. Define ICP criteria (industry, size, role, geography)
2. Use web_search to find matching companies
3. Enrich leads via http_request to Apollo/HubSpot/Hunter.io APIs
4. Score each lead (ICP fit 1-5, company size 1-5, seniority 1-5) — only keep 10+
5. Write scored lead list to file with write_file
SUCCESS: ≥10 qualified leads with contact info, all scored
```

This is not a tool-calling schema — it's plain instructional text the LLM
reads as part of its system prompt, the same way you'd brief a new hire.

## Pre-compiled `.skill` Files

Alongside the system prompt, each department has a directory of pre-compiled
skill files that the runtime's `SkillCompiler`
(`packages/runtime/src/skills/compiler.ts`) can match against a task
description and inject as additional context:

```
packages/orch/src/registry/skills/
  growth/
    SKILLS_INDEX.md           ← human-readable reference (see below)
    lead-generation.skill
    email-sequence.skill
    outreach-copy.skill
    growth-metrics.skill
  product/
    SKILLS_INDEX.md
    product-manager.skill
    spec-writing.skill
    user-research.skill
    github-issues.skill
  engops/
    SKILLS_INDEX.md
    incident-responder.skill
    runbook-writer.skill
    deployment-engineer.skill
    devops-troubleshooter.skill
```

### The `.skill` file format

Each `.skill` file is JSON matching the `SkillFile` interface
(`packages/runtime/src/types.ts`):

```jsonc
{
  "name": "lead-generation",
  "description": "Scrape and qualify leads from LinkedIn Apollo Google Maps ...",
  "steps": [
    {
      "action": "Define ICP criteria: industry, company size, role, geography",
      "expectedOutcome": "Clear targeting criteria before any search"
    },
    {
      "action": "Use web_search to find matching companies and contacts",
      "tool": "web_search",
      "args": { "query": "{{ICP criteria}} companies site:linkedin.com" }
    }
    // ... more steps
  ],
  "preconditions": [
    "ICP (Ideal Customer Profile) clearly defined"
  ],
  "successCriteria": [
    "Minimum 10 qualified leads with contact information"
  ],
  "compiledFrom": "apify/agent-skills@apify-lead-generation + community/growth-engine",
  "compiledAt": "2026-07-04T00:00:00.000Z"
}
```

`description` is a keyword-dense summary — `scoreRelevance()`
(`packages/runtime/src/skills/matcher.ts`) does a Jaccard-similarity match
between the task description's tokens and this field, so favor domain
keywords over polished prose.

`SKILLS_DIR` (see [CONFIGURATION.md](CONFIGURATION.md)) points the runtime's
`SkillCompiler` at one of these directories — it's auto-resolved from the
`DEPARTMENT` env var, so an agent started with `DEPARTMENT=growth`
automatically draws from `packages/orch/src/registry/skills/growth/`.

## Skill Provenance

The skills shipped in this repo were sourced from two places:

1. **[MMEHDI0606/ai-agent-foundation-template](https://github.com/MMEHDI0606/ai-agent-foundation-template)**
   — a curated collection of 1500+ agent skill definitions covering growth,
   product, DevOps, security, and more
2. **[`npx skills find`](https://skills.sh)** — a searchable public skill
   registry; each `.skill` file's `compiledFrom` field credits the specific
   upstream skill(s) it was adapted from

See each department's `SKILLS_INDEX.md` for the full attribution list and a
quick-reference table mapping task keywords to the right skill.

## Adding a New Skill

1. Write the `.skill` JSON file following the format above and drop it in
   the relevant department directory (or a new one)
2. Add an entry to that department's `SKILLS_INDEX.md` — the "when to use /
   workflow / success" summary, and the keyword routing table row
3. If the worker's system prompt embeds a written skill index (as `growth`,
   `product`, and `engops` do), add a matching section there too — the
   `.skill` file alone only helps *after* similar tasks have run once;
   the system prompt section helps from the very first task
4. Make sure any tools the skill's steps reference
   (`packages/runtime/src/tools/built-in/`) are in the worker's `tools` list
   in its `AgentConfig`

## Adding a New Department

1. Create `packages/orch/src/registry/templates/<name>.ts` exporting a
   `<name>Template(tenantId: string): AgentConfig[]` function — one
   architect (`tools: ["create_task"]`), one or more workers
2. Create `packages/orch/src/registry/skills/<name>/` with a
   `SKILLS_INDEX.md` and at least one `.skill` file
3. Register the template in `packages/orch/src/registry/department-manager.ts`
4. Wire it into the Rust CLI: add a `DepartmentTemplate` const and a match
   arm in `rust/sockt-cli/src/commands/department/templates.rs` (see
   `GROWTH_TEMPLATE` / `get_template()` for the pattern), and add it to the
   `list_all_templates()` / `list_template_names()` arrays
5. `sockt department add <name>` should now work

## Escalation & Human-in-the-Loop

The `engops` department's skill index includes an explicit escalation
section — security breaches, data loss, payment failures, and unresolved P0s
past 30 minutes should never be handled by an automated fix. If you're
writing a skill for a department that touches production systems or money,
include an equivalent "always escalate to humans" section rather than
assuming the LLM will infer the boundary on its own.
