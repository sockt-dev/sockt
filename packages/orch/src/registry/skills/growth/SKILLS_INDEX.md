# Growth Department — Skill Index

Skills sourced from: MMEHDI0606/ai-agent-foundation-template + npx skills registry

---

## Available Skills

### 1. `lead-generation`
**When to use:** Task involves finding prospects, building contact lists, sourcing leads
**What it does:** Scrape and qualify leads from LinkedIn, Apollo, Google Maps, Instagram
**Key tools:** `web_search`, `http_request` (Apollo/Hunter.io API), `write_file`
**Output:** Scored lead list with company, name, role, email, ICP fit score

### 2. `email-sequence`
**When to use:** Task involves writing email campaigns, drip sequences, nurture flows
**What it does:** Design and write multi-email sequences with single CTA per email
**Sequence types:** Welcome (3-7 emails), Lead nurture (5-10), Re-engagement (3-5)
**Output:** Full sequence copy with timing, subjects, bodies, CTAs

### 3. `outreach-copy`
**When to use:** Task involves writing cold emails, LinkedIn messages, sales copy
**What it does:** Personalised outreach using AIDA / PAS copywriting frameworks
**Frameworks:** AIDA (cold), PAS (pain-aware), always under 150 words
**Output:** 2-3 copy variants per outreach type, personalised to prospect

### 4. `growth-metrics`
**When to use:** Task involves measuring growth, diagnosing funnel drop-offs, strategy
**What it does:** AARRR analysis, K-factor calculation, funnel optimisation experiments
**Metrics:** Acquisition, Activation (FCR), Retention (D7/D30), Revenue (MRR/ARPU), Referral (K-factor)
**Output:** Growth report with bottleneck identification and experiment backlog

---

## Skill Selection Guide

| Task keywords | Use skill |
|---------------|-----------|
| leads, prospects, contacts, scrape, find companies | `lead-generation` |
| email, sequence, drip, nurture, campaign, newsletter | `email-sequence` |
| outreach, cold email, LinkedIn message, copy, pitch | `outreach-copy` |
| metrics, funnel, conversion, growth, retention, viral | `growth-metrics` |

---

## Sources

- `apify/agent-skills@apify-lead-generation` (2.8K installs)
- `louisblythe/salesskills@email-sequence` (173 installs)
- `thatrebeccarae/claude-marketing@copywriting-frameworks` (48 installs)
- `aradotso/marketing-skills@seo-content-marketing-skills` (954 installs)
- `iamzifei/show-me-the-money@money-outreach` (32 installs)
- `MMEHDI0606/ai-agent-foundation-template` (growth-engine, hubspot-automation, linkedin-automation)
