# Sockt — UI Design Doc

## What We're Building

An **agent operations dashboard** — a UI for the backend packages in this repo (`fsm`, `orch`, `runtime`, `memory`, `cadvp`). This is not the marketing site (that lives at `C:\Users\hkals\sockt\web\`). This is the live control plane for running and monitoring agent swarms.

---

## Existing Design System (from `C:\Users\hkals\sockt\web\`)

All UI decisions should follow the existing Sockt design system. Do not invent new patterns.

### Stack
- **Next.js 16** (App Router, Turbopack off in prod, webpack)
- **React 19**
- **TypeScript 6**
- **Tailwind CSS 3.4**
- **GSAP 3.15 + ScrollTrigger** (animations)
- **Lenis 1.3** (smooth scroll)
- **Supabase** (auth + DB)
- **Polar** (billing)

### Color Tokens

```css
/* Dark mode (primary) */
--bg-void:     #09090B   /* page background */
--bg-surface:  #0E0E12   /* card backgrounds */
--bg-raised:   #151519   /* elevated elements */
--bg-border:   #26262B   /* borders, dividers */
--text-primary: #EEECE8  /* warm off-white */
--text-secondary: #6D6D78 /* muted label text */
--text-mono:   #A09D98   /* monospace / code */
--accent-green: #22D07A  /* success, completed */
--accent-red:  #E53E3E   /* error, cancelled */
--accent-btc:  #EEECE8   /* neutral (was amber) */

/* Light mode */
--bg-void:     #F1F0EC
--text-primary: #1C1B18
```

### Typography

| Use | Font | Weight | Size |
| --- | ---- | ------ | ---- |
| Hero / display | Fraunces (variable serif) | 800→200 contrast | clamp(3rem, 6vw, 6rem) |
| Section headings | DM Sans | 700 | clamp(2rem, 4vw, 3.8rem) |
| Body / UI | Geist | 400–500 | 14–16px |
| Labels / code | Fira Code / Geist Mono | 400 | 12–13px |

### Motion

```css
--ease-expo: cubic-bezier(0.16, 1, 0.3, 1)
--ease-snap: cubic-bezier(0.77, 0, 0.175, 1)
--dur-fast:   180ms
--dur-medium: 360ms
--dur-slow:   720ms
```

- GSAP ScrollTrigger for scroll-driven reveals (staggered, y-offset)
- Lenis for page-level smooth scroll
- Inline `style={{}}` pattern dominant across components
- `useReveal.tsx` hook for scroll-triggered entry animations

### Component Patterns

- **Cards**: `--bg-surface` bg, 1px `--bg-border` border, 16–18px radius, subtle box-shadow
- **Buttons (primary)**: filled, rounded pill (border-radius: 999px), hover opacity 0.8
- **Buttons (secondary)**: outlined, same pill shape
- **Inputs**: `--bg-surface` bg, 1px border, `--text-primary` text, monospace labels above
- **Status badges**: small pill, color-coded (green=completed, red=error, muted=pending)

### Existing Reusable Components

| Component | Location | Reuse in dashboard? |
| --------- | -------- | ------------------- |
| `Nav.tsx` | `web/components/nav/` | Yes — same nav shell |
| `Footer.tsx` | `web/components/sections/` | Yes |
| `AuthForm.tsx` | `web/components/auth/` | Yes — login/signup already done |
| `ApiKeysPanel.tsx` | `web/components/dashboard/` | Yes — reuse for API key mgmt |
| `ThemeToggle.tsx` | `web/components/theme/` | Yes |
| `SmoothScrollProvider.tsx` | `web/components/providers/` | Yes |
| `useReveal.tsx` | `web/hooks/` | Yes |
| `useIsMobile.ts` | `web/hooks/` | Yes |
| `useCounter.ts` | `web/hooks/` | Yes (stats panels) |
| `AmbientBlobs.tsx` | `web/components/canvas/` | Optional (background) |
| `SwarmOrbit.tsx` | `web/components/svg/` | Yes — agent status viz |
| `MemoryPulse.tsx` | `web/components/svg/` | Yes — memory panel |
| `Marquee.tsx` | `web/components/svg/` | Optional |

---

## Backend Data Available (Orchestrator API)

The orchestrator exposes an HTTP API (Hono). These are the endpoints the UI will call.

### Tasks

```
POST   /tasks/claim              — agent claims next pending task
POST   /tasks/:id/complete       — mark task completed with output
POST   /tasks/:id/escalate       — escalate task
GET    /tasks/:id                — get single task
GET    /tasks?tenantId=&status=  — list/filter tasks
POST   /tasks                    — create task
PATCH  /tasks/:id                — patch task (description, budget, etc.)
```

### Agents

```
POST   /agents/register          — register new agent config
GET    /agents/:id               — get agent config
GET    /agents?tenantId=         — list agents for tenant
DELETE /agents/:id               — deregister agent
```

### Departments

```
GET    /departments              — list department templates
POST   /departments              — create department
GET    /departments/:id/agents   — agents in a department
```

### Health

```
GET    /health                   — orchestrator health check
GET    /health/tasks             — task queue stats
```

### Approvals (HITL)

```
POST   /approvals/request        — request human approval
POST   /approvals/:id/decide     — approve or reject
GET    /approvals/pending        — list pending approvals
```

---

## Task State Machine (FSM)

```
pending ──────────────────────────────→ in_progress
                                              │
                         ┌────────────────────┤
                         ↓           ↓        ↓
                     completed   escalated  blocked
                                     │        │
                                     └────────┘
                                          │
                                          ↓
                                       pending  (re-queued)
                                          
Any state → cancelled
```

**Budget guard:** `llmCallsUsed / llmCallsBudget` — shown as a progress bar per task. When full → auto-escalated.

---

## Screens to Build

### 1. Dashboard Home `/dashboard`

Already exists at `web/app/dashboard/page.tsx` — extend, don't replace.

Currently shows: API keys, credit balance, user profile.

**Add:**
- Active swarm summary (N tasks running, N agents online)
- Recent task feed (last 10 tasks across all departments)
- Credit burn rate (credits used today / this week)
- Quick-launch button → spawn a new task

---

### 2. Task Board `/dashboard/tasks`

The core operational view.

**Layout:** Kanban columns by status: `pending | in_progress | completed | escalated | blocked | cancelled`

**Task Card shows:**
- Task ID (truncated, monospace)
- Description (1–2 lines)
- Assigned agent (name + role badge)
- Department
- Budget bar: `llmCallsUsed / llmCallsBudget` (green → amber → red as it fills)
- Created at / time in current state
- Parent task link (if subtask)

**Filters:** department, agent, status, date range

**Actions per card:**
- View detail (expand/modal)
- Escalate
- Cancel
- Re-queue (for escalated/blocked)

**Task Detail Modal:**
- Full description + output
- Execution trace (steps: Plan/Act/Observe/Reflect log)
- LLM calls breakdown
- HITL approval panel (if escalated pending approval)
- Subtasks list (if parent)

---

### 3. Agent Registry `/dashboard/agents`

**List view:** Table of registered agents

| Column | Notes |
| ------ | ----- |
| Name | + role badge (architect / worker) |
| Department | color-coded pill |
| LLM | provider + model name |
| Active tasks | count, clickable |
| Budget headroom | avg llmCallsUsed% across active tasks |
| Status | online / idle / offline |
| Actions | Edit, Deregister |

**Create Agent Panel (slide-out):**
- Name, role (architect/worker)
- Department
- LLM provider + model dropdown
- System prompt textarea (monospace)
- Tools (multi-select checklist)
- Max concurrent tasks (number input)
- Budget default (LLM calls per task)

---

### 4. Memory Explorer `/dashboard/memory`

Browse what agents have learned.

**Search bar** (semantic query) → calls `memoryStore.retrieve()`

**Results list:**
- Memory entry content (truncated, expandable)
- Category badge (`MemoryCategory` enum)
- Source agent
- Timestamp
- Cosine similarity score to query (shown as %)
- Deduplicated from N sources

**Filters:** category, agent, date range, department

**No write UI** — memory is append-only via CADVP. Users can only search and delete entries.

---

### 5. HITL Approvals `/dashboard/approvals`

Human-in-the-loop gate. Agents escalate tasks here for human review.

**Pending approvals list:**
- Task description
- Escalation reason (from agent output)
- Requesting agent
- Time waiting
- Approve / Reject buttons

**Approval detail:**
- Full task context + execution trace
- What the agent is asking permission to do
- Approve (with optional note) / Reject (with required reason)

**Audit log:** all past approval decisions

---

### 6. CADVP Monitor `/dashboard/cadvp`

Live view of the CADVP daemon's ingestion pipeline.

**Stats bar:**
- Events processed today
- Duplicates filtered (cosine > 0.92)
- Memory entries written
- Last flush timestamp

**Live event feed** (tail of JSONL — WebSocket or polling):
- Timestamp
- Event type badge
- Agent source
- Content preview
- Dedup status: `stored` / `skipped (0.95 sim)`

**Config panel:**
- `dedupThreshold` (default 0.92)
- `batchSize` (default 10)
- `flushIntervalMs` (default 2000ms)
- `pollIntervalMs` (default 500ms)

---

### 7. Settings `/dashboard/settings`

Already partially built (`web/app/dashboard/account/page.tsx`).

**Add:**
- Orchestrator API URL (where the Hono server is running)
- Default LLM provider + model
- Default task budget (LLM calls)
- HITL tier (none / notify / block)
- Department management (create/rename/delete)
- Billing (Polar topup — already exists via `SyncCredits.tsx`)

---

## Navigation Structure

```
/dashboard                 — home / swarm overview
/dashboard/tasks           — task board (kanban)
/dashboard/agents          — agent registry
/dashboard/memory          — memory explorer
/dashboard/approvals       — HITL approval queue
/dashboard/cadvp           — CADVP monitor
/dashboard/settings        — settings + billing
```

Extend the existing `Nav.tsx` — add a sidebar for dashboard routes (collapses to icon-only on narrow screens).

---

## Data Polling Strategy

The orchestrator does not push events to the UI (no WebSocket currently). Use polling:

| View | Poll interval | Notes |
| ---- | ------------ | ----- |
| Task board | 5s | SWR or React Query with revalidateOnFocus |
| CADVP feed | 1s | Tight poll, show last 50 events |
| Approvals | 10s | Low urgency |
| Agent status | 10s | |
| Dashboard home | 30s | Summary stats |

If WebSocket support is added to the Hono server (`Bun.serve()` supports it natively), replace polling with push.

---

## Auth Integration

Auth is already handled by Supabase at `web/utils/supabase/`. The dashboard UI checks session in middleware (`web/utils/supabase/middleware.ts`) and redirects to `/login` if unauthenticated.

The orchestrator API calls need the user's API key (from `ApiKeysPanel`) passed as `Authorization: Bearer <key>` header. Store the active key in a React context or Zustand store, not localStorage.

---

## Build Order

1. **Navigation shell** — extend `Nav.tsx` with sidebar for dashboard routes
2. **Task board** — highest priority, core operational view
3. **Agent registry** — CRUD for agents
4. **Dashboard home** — add swarm summary widgets to existing page
5. **HITL approvals** — needed for any escalated tasks
6. **Memory explorer** — search interface
7. **CADVP monitor** — ops/debug view
8. **Settings** — extend existing account page

---

## Key Files to Reference Before Building

| File | Why |
| ---- | --- |
| `C:\Users\hkals\sockt\web\app\globals.css` | All color + motion tokens |
| `C:\Users\hkals\sockt\web\tailwind.config.js` | Tailwind color extensions |
| `C:\Users\hkals\sockt\web\components\nav\Nav.tsx` | Existing nav to extend |
| `C:\Users\hkals\sockt\web\components\dashboard\ApiKeysPanel.tsx` | Existing dashboard pattern |
| `C:\Users\hkals\sockt\web\app\dashboard\actions.ts` | Server action pattern |
| `C:\Users\hkals\sockt\web\utils\supabase\` | Auth client pattern |
| `packages\orch\src\` | Orchestrator API source |
| `packages\types\src\` | All shared types |
| `packages\fsm\src\` | Task states + budget logic |
