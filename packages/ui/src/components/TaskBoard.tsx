import React, { useState, useEffect, useCallback } from "react"
import type { Task, TaskStatus } from "../types"
import { api } from "../api"
import { getTenantId } from "../api"

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "pending",     label: "Pending",     color: "var(--text-secondary)" },
  { status: "in_progress", label: "In Progress", color: "var(--accent-blue)" },
  { status: "escalated",   label: "Escalated",   color: "var(--accent-amber)" },
  { status: "blocked",     label: "Blocked",     color: "var(--accent-red)" },
  { status: "completed",   label: "Completed",   color: "var(--accent-green)" },
  { status: "cancelled",   label: "Cancelled",   color: "var(--bg-border)" },
]

export default function TaskBoard() {
  const [tasks,   setTasks]   = useState<Task[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.getTasks()
      setTasks(data); setError(null)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5_000)
    return () => clearInterval(t)
  }, [load])

  const byStatus = (status: TaskStatus) => tasks.filter(t => t.status === status)

  return (
    <div>
      <div className="page-header row">
        <div>
          <h1>Task Board</h1>
          <p>All tasks across the swarm</p>
        </div>
        <button className="btn btn-primary ml-auto" onClick={() => setCreating(true)}>
          + New Task
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}
      {loading && <div className="loading">Loading tasks...</div>}

      {!loading && (
        <div className="kanban">
          {COLUMNS.map(col => (
            <KanbanCol
              key={col.status}
              col={col}
              tasks={byStatus(col.status)}
              onSelect={setSelected}
              onAction={load}
            />
          ))}
        </div>
      )}

      {selected && (
        <TaskModal
          task={selected}
          onClose={() => setSelected(null)}
          onAction={() => { setSelected(null); load() }}
        />
      )}

      {creating && (
        <CreateTaskModal
          onClose={() => setCreating(false)}
          onCreate={() => { setCreating(false); load() }}
        />
      )}
    </div>
  )
}

/* ── Kanban Column ─────────────────────────────────────────────────── */
function KanbanCol({ col, tasks, onSelect, onAction }: {
  col: { status: TaskStatus; label: string; color: string }
  tasks: Task[]
  onSelect: (t: Task) => void
  onAction: () => void
}) {
  return (
    <div className="kanban-col">
      <div className="kanban-col-header">
        <span className="kanban-col-accent" style={{ background: col.color }} />
        <span className="kanban-col-title" style={{ color: col.color }}>{col.label}</span>
        <span className="kanban-col-count">{tasks.length}</span>
      </div>
      <div className="kanban-cards">
        {tasks.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0", fontFamily: "'Fira Code', monospace" }}>
            empty
          </div>
        )}
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} onClick={() => onSelect(task)} />
        ))}
      </div>
    </div>
  )
}

/* ── Task Card ─────────────────────────────────────────────────────── */
function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const pct = task.llmCallsBudget > 0 ? Math.min((task.llmCallsUsed / task.llmCallsBudget) * 100, 100) : 0
  const budgetClass = pct > 80 ? "budget-high" : pct > 60 ? "budget-mid" : "budget-low"

  return (
    <div className="task-card" onClick={onClick}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 10 }}>{task.id.slice(0, 8)}</span>
        {task.parentId && (
          <span style={{ fontSize: 9, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace", background: "var(--bg-surface)", padding: "1px 5px", borderRadius: 4 }}>
            subtask
          </span>
        )}
      </div>

      <p style={{
        fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5,
        marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {task.description}
      </p>

      <div className="row" style={{ marginBottom: 8 }}>
        {task.owner ? (
          <span style={{ fontSize: 10, fontFamily: "'Fira Code', monospace", color: "var(--text-secondary)" }}>
            {task.owner.slice(0, 12)}
          </span>
        ) : (
          <span style={{ fontSize: 10, fontFamily: "'Fira Code', monospace", color: "var(--bg-border)" }}>
            unassigned
          </span>
        )}
        <span className="mono ml-auto" style={{ fontSize: 10 }}>{task.llmCallsUsed}/{task.llmCallsBudget}</span>
      </div>

      <div className="budget-bar">
        <div className={`budget-fill ${budgetClass}`} style={{ width: `${pct}%` }} />
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>
        {timeAgo(task.updatedAt)}
      </div>
    </div>
  )
}

/* ── Task Detail Modal ─────────────────────────────────────────────── */
function TaskModal({ task, onClose, onAction }: { task: Task; onClose: () => void; onAction: () => void }) {
  const [busy, setBusy] = useState(false)

  const handle = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); onAction() }
    catch (e) { alert(String(e)) }
    finally { setBusy(false) }
  }

  const pct = task.llmCallsBudget > 0 ? Math.min((task.llmCallsUsed / task.llmCallsBudget) * 100, 100) : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className={`badge badge-${task.status}`} style={{ marginBottom: 6, display: "inline-flex" }}>
              {task.status.replace("_", " ")}
            </span>
            <h2 style={{ fontSize: 15 }}>{task.description}</h2>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          {/* Metadata grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Field label="Task ID"   value={task.id} mono />
            <Field label="Tenant"    value={task.tenantId} mono />
            <Field label="Owner"     value={task.owner ?? "unassigned"} mono />
            <Field label="Parent"    value={task.parentId ?? "—"} mono />
            <Field label="Attempts"  value={`${task.attemptCount} / ${task.maxAttempts}`} mono />
            <Field label="Updated"   value={timeAgo(task.updatedAt)} mono />
          </div>

          {/* Budget */}
          <div style={{ marginBottom: 16 }}>
            <span className="label">LLM Budget — {task.llmCallsUsed} / {task.llmCallsBudget} calls ({Math.round(pct)}%)</span>
            <div className="budget-bar" style={{ height: 6 }}>
              <div className={`budget-fill ${pct > 80 ? "budget-high" : pct > 60 ? "budget-mid" : "budget-low"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Output */}
          {task.output && (
            <div style={{ marginBottom: 16 }}>
              <span className="label">Output</span>
              <div style={{
                background: "var(--bg-void)", border: "1px solid var(--bg-border)",
                borderRadius: 8, padding: "12px 14px",
                fontFamily: "'Fira Code', monospace", fontSize: 12,
                color: "var(--text-primary)", whiteSpace: "pre-wrap", lineHeight: 1.6,
                maxHeight: 200, overflowY: "auto",
              }}>
                {task.output}
              </div>
            </div>
          )}

          <div className="divider" />

          {/* Actions */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {task.status === "escalated" || task.status === "blocked" ? (
              <button disabled={busy} className="btn btn-success" onClick={() => handle(() => api.requeueTask(task.id))}>
                Re-queue
              </button>
            ) : null}
            {task.status !== "cancelled" && task.status !== "completed" && (
              <button disabled={busy} className="btn btn-danger" onClick={() => handle(() => api.cancelTask(task.id))}>
                Cancel
              </button>
            )}
            <button className="btn btn-ghost ml-auto" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Create Task Modal ─────────────────────────────────────────────── */
function CreateTaskModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [desc,   setDesc]   = useState("")
  const [budget, setBudget] = useState("10")
  const [parent, setParent] = useState("")
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!desc.trim()) return
    setBusy(true)
    try {
      await api.createTask({
        description: desc.trim(),
        llmCallsBudget: Number(budget) || 10,
        parentId: parent.trim() || undefined,
      })
      onCreate()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Task</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={submit} className="col" style={{ gap: 14 }}>
            <div className="form-field">
              <label className="label">Description *</label>
              <textarea
                className="textarea"
                placeholder="Describe what the agent should accomplish..."
                value={desc}
                onChange={e => setDesc(e.target.value)}
                rows={4}
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label className="label">LLM call budget</label>
                <input
                  className="input input-mono"
                  type="number" min={1} max={500}
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="label">Parent task ID (optional)</label>
                <input
                  className="input input-mono"
                  placeholder="uuid..."
                  value={parent}
                  onChange={e => setParent(e.target.value)}
                />
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !desc.trim()}>
                {busy ? "Creating..." : "Create Task"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ───────────────────────────────────────────────────────── */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span style={{
        fontSize: mono ? 11 : 13,
        fontFamily: mono ? "'Fira Code', monospace" : undefined,
        color: "var(--text-primary)",
        wordBreak: "break-all",
      }}>
        {value}
      </span>
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
