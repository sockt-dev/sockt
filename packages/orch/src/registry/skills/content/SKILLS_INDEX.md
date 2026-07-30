# Content Department — Skill Index

Skills built for the Sockt Content Department. Customer-deployable. Platforms: X/Twitter, LinkedIn, YouTube/TikTok. Flow: Draft → Slack Approval → Publish.

---

## Available Skills

### 1. `x-thread-writer`
**When to use:** Task involves writing X/Twitter threads, topic breakdowns, or punchy multi-tweet takes
**What it does:** 6-9 tweet thread with open-loop hook (contrarian / metric-led / failure story), numbered body tweets, proof tweet, single CTA
**2026 framework:** Bookmarks as virality metric; links go in first reply (algorithm suppresses them in tweets)
**Output:** `x_thread_draft.md` — hook + numbered tweets + CTA

### 2. `linkedin-post-writer`
**When to use:** Task involves LinkedIn posts, thought leadership, founder POV, or carousel briefs
**What it does:** Hook-whitespace-bullets pattern post (900-1200 chars optimal) or carousel slide headlines
**2026 framework:** White space required (1-2 sentences per paragraph); no corporate language; hashtags 3-5 max, niche-specific
**Content mix:** 40% tactical how-tos (carousels) / 30% founder POV / 20% data / 10% polls
**Output:** `linkedin_post_draft.md` — formatted post or carousel outline

### 3. `youtube-script-writer`
**When to use:** Task involves YouTube videos (8-20 min) or TikTok/Reels scripts (15-90 sec)
**What it does:** Open-loop hook (first 3-30 seconds), PSSP body (Problem-Stakes-Solution-Proof), pattern interrupts every 60s, specific CTA
**2026 framework:** 65% of viewers drop in first 10s; front-load value; [B-ROLL] and [ON-SCREEN TEXT] cues included
**Output:** `video_script_draft.md` — full script with timing markers and visual direction

### 4. `content-calendar`
**When to use:** Task involves planning a content schedule, content pillars, or weekly/monthly posting plan
**What it does:** Defines 3-5 content pillars, sets platform cadence (X: 1 thread/day; LinkedIn: 4-5x/week M-F; YouTube: 1/week; TikTok: 3-5/week), sources trending topics via web_search, writes individual content briefs
**Output:** `content_calendar.md` — markdown table calendar + individual briefs

### 5. `content-repurposing`
**When to use:** Task involves turning one source piece (blog, podcast, case study, data report) into multi-platform content
**What it does:** Distills source into thesis + insights, then creates platform-native pieces for X (distinct hook), LinkedIn (different angle, white space), and YouTube/TikTok (visual script) — not copy-paste
**Output:** `x_thread_draft.md` + `linkedin_post_draft.md` + `video_script_draft.md` + `repurposing_summary.md`

### 6. `slack-approval-publisher`
**When to use:** Task involves submitting a completed draft for human approval before publishing
**What it does:** Posts draft to Slack approval channel with full text, waits for HITL approval (24h timeout), publishes to platform API on approval, logs rejection + reason on reject
**APIs:** Twitter API v2 (`/tweets`), LinkedIn UGC Posts API (`/ugcPosts`), YouTube Data API v3
**Output:** Published post URL (approved) or `rejected_draft_{{task_id}}.md` (rejected)

---

## Skill Selection Guide

| Task keywords | Use skill |
|---|---|
| thread, X post, twitter, punchy take, tweet | `x-thread-writer` |
| linkedin, carousel, thought leadership, founder post, text post | `linkedin-post-writer` |
| youtube, tiktok, reels, video script, shorts, hook, b-roll | `youtube-script-writer` |
| calendar, schedule, content plan, pillars, cadence, weekly plan | `content-calendar` |
| repurpose, transform, multiple platforms, adapt, reformat | `content-repurposing` |
| publish, post, approve, send for review, slack approval | `slack-approval-publisher` |

---

## 2026 Platform Cheat Sheet

| Platform | Optimal Cadence | Peak Times | Links |
|---|---|---|---|
| X / Twitter | 1 thread/day + 3-5 short posts | 8-10 AM, 12-1 PM, 5-7 PM | Put in first reply, never in tweet |
| LinkedIn | 4-5 posts/week (Mon–Fri only) | 7-9 AM, 12 PM | Put in comments |
| YouTube | 1 video/week or bi-weekly | Thu–Sat upload for weekend peak | Description + cards |
| TikTok/Reels | 3-5/week | 6-9 PM local | Bio link |

---

## Sources & Star Counts

**npm packages integrated into content agent pipelines:**
- `compromise` (12.1k ⭐) — NLP entity/hashtag extraction from drafts
- `natural` (10.9k ⭐) — content classification and keyword scoring
- `marked` (35k ⭐) — Markdown rendering for content pipelines
- `remark` (8k ⭐) — AST-based Markdown transformation
- `gray-matter` (5k ⭐) — frontmatter parsing for content files
- `BullMQ` (6k ⭐) — scheduled publishing job queues
- `rss-parser` (1.5k ⭐) — trend ingestion from industry feeds
- `sentiment` (3k ⭐) — pre-publish toxicity/sentiment check
- `cheerio` (29k ⭐) — web scraping for trend research
- `turndown` (8k ⭐) — HTML to Markdown for repurposing

**Skill frameworks sourced from:**
- `hypefury/thread-frameworks@2026` — X hook formulas (metric-led, contrarian, open loop)
- `justin-welsh/linkedin-os@post-frameworks` — LinkedIn white-space structure
- `dickie-bush/ship30@repurposing-framework` — single-piece → multi-platform
- `vidIQ/content-strategy@2026` — YouTube hook science and script templates
- `later/content-strategy@calendar-frameworks` — B2B content pillar methodology
- `MMEHDI0606/ai-agent-foundation-template@content-ops` — Sockt internal
- `charlie947/social-media-skills@hook-generator` + `@post-writer` (Claude Code marketplace)
