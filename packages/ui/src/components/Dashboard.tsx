import React, { useState, useEffect } from "react"
import type { Task, HealthStats, Route } from "../types"
import { api } from "../api"

const STATUS_COLORS: Record<string, string> = {
  pending:     "var(--text-secondary)",
  in_progress: "var(--accent-blue)",
  completed:   "var(--accent-green)",
  escalated:   "var(--accent-amber)",
  blocked:     "var(--accent-red)",
  cancelled:   "var(--text-secondary)",
}

interface Props { onNavigate: (r: Route) => void }

export default function Dashboard({ onNavigate }: Props) {
  const [health,  setHealth]  = useState<HealthStats | null>(null)
  const [tasks,   setTasks]   = useState<Task[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [h, t] = await Promise.all([api.health(), api.getTasks()])
        if (!cancelled) { setHealth(h); setTasks(t); setError(null) }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const tasksByStatus = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})

  const recent = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8)

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Agent swarm overview</p>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: 20 }}>
          Cannot reach orchestrator — start it with:<br />
          <strong>bun run packages/orch/src/index.ts</strong><br /><br />
          Then configure the URL in{" "}
          <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => onNavigate("settings")}>
            Settings
          </span>.
        </div>
      )}

      {/* Stats row */}
      <div className="stats-grid">
        <StatCard
          value={loading ? "—" : String(tasksByStatus["in_progress"] ?? 0)}
          label="Running tasks"
          color="var(--accent-blue)"
        />
        <StatCard
          value={loading ? "—" : String(tasksByStatus["pending"] ?? 0)}
          label="Queued tasks"
          color="var(--text-secondary)"
        />
        <StatCard
          value={loading ? "—" : String(tasksByStatus["escalated"] ?? 0)}
          label="Escalated"
          color="var(--accent-amber)"
        />
        <StatCard
          value={loading ? "—" : String(health?.agents ?? 0)}
          label="Registered agents"
          color="var(--accent-green)"
        />
        <StatCard
          value={loading ? "—" : String(tasksByStatus["completed"] ?? 0)}
          label="Completed"
          color="var(--accent-green)"
        />
        <StatCard
          value={loading ? "—" : String(tasks.length)}
          label="Total tasks"
          color="var(--text-primary)"
        />
      </div>

      {/* Status breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Task status breakdown</h3>
          {["pending","in_progress","completed","escalated","blocked","cancelled"].map(s => {
            const count = tasksByStatus[s] ?? 0
            const total = tasks.length || 1
            return (
              <div key={s} style={{ marginBottom: 10 }}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Fira Code', monospace", fontSize: 11, color: STATUS_COLORS[s] }}>
                    {s.replace("_", " ")}
                  </span>
                  <span className="mono" style={{ marginLeft: "auto" }}>{count}</span>
                </div>
                <div className="budget-bar">
                  <div
                    className="budget-fill"
                    style={{
                      width: `${(count / total) * 100}%`,
                      background: STATUS_COLORS[s],
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Quick actions */}
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Quick actions</h3>
          <div className="col" style={{ gap: 8 }}>
            <ActionBtn label="View task board" sub="Kanban by status" onClick={() => onNavigate("tasks")} />
            <ActionBtn label="Register agent"  sub="Add worker or architect" onClick={() => onNavigate("agents")} />
            <ActionBtn label="Search memory"   sub="Query agent knowledge" onClick={() => onNavigate("memory")} />
            <ActionBtn label="Review approvals" sub={tasksByStatus["escalated"] ? `${tasksByStatus["escalated"]} waiting` : "No pending"} onClick={() => onNavigate("approvals")} />
          </div>
        </div>
      </div>

      {/* Recent tasks */}
      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3>Recent tasks</h3>
          <button className="btn btn-ghost btn-sm ml-auto" onClick={() => onNavigate("tasks")}>
            View all →
          </button>
        </div>
        {loading ? (
          <div className="loading">Loading tasks...</div>
        ) : recent.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◻</div>
            <div>No tasks yet</div>
            <div style={{ fontSize: 12 }}>Tasks will appear here once agents start working</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Budget</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(task => (
                  <tr key={task.id}>
                    <td><span className="mono">{task.id.slice(0, 8)}</span></td>
                    <td style={{ maxWidth: 260 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.description}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${task.status}`}>
                        {task.status.replace("_", " ")}
                      </span>
                    </td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{task.owner?.slice(0, 10) ?? "—"}</span></td>
                    <td>
                      <BudgetBar used={task.llmCallsUsed} budget={task.llmCallsBudget} />
                    </td>
                    <td><span className="mono">{timeAgo(task.updatedAt)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function ActionBtn({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 12px", borderRadius: 8,
        background: "var(--bg-raised)", border: "1px solid var(--bg-border)",
        cursor: "pointer", width: "100%", transition: "border-color var(--dur-fast) var(--ease-expo)",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--text-secondary)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--bg-border)")}
    >
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>{sub}</div>
      </div>
      <span style={{ color: "var(--text-secondary)", fontSize: 16 }}>→</span>
    </button>
  )
}

function BudgetBar({ used, budget }: { used: number; budget: number }) {
  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0
  const cls = pct > 80 ? "budget-high" : pct > 60 ? "budget-mid" : "budget-low"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div className="budget-bar" style={{ width: 48 }}>
        <div className={`budget-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="mono">{used}/{budget}</span>
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
