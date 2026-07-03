import React, { useState, useEffect, useCallback } from "react"
import type { ApprovalRequest } from "../types"
import { api } from "../api"

export default function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getPendingApprovals()
      setApprovals(data); setError(null)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div>
      <div className="page-header row">
        <div>
          <h1>Approvals</h1>
          <p>Human-in-the-loop decisions for escalated tasks</p>
        </div>
        {approvals.length > 0 && (
          <span style={{
            marginLeft: "auto",
            background: "rgba(245,158,11,.15)", color: "var(--accent-amber)",
            fontFamily: "'Fira Code', monospace", fontSize: 12,
            padding: "4px 12px", borderRadius: 999,
          }}>
            {approvals.length} pending
          </span>
        )}
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="loading">Loading approvals...</div>
      ) : approvals.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: 36 }}>✓</div>
          <div>No pending approvals</div>
          <div style={{ fontSize: 12 }}>
            Agents will appear here when they need human sign-off to continue.
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {approvals.map(a => (
            <ApprovalCard key={a.id} approval={a} onDecide={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function ApprovalCard({ approval, onDecide }: { approval: ApprovalRequest; onDecide: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [note,     setNote]     = useState("")
  const [busy,     setBusy]     = useState(false)

  const decide = async (approved: boolean) => {
    setBusy(true)
    try {
      await api.decide(approval.id, approved, note.trim() || undefined)
      onDecide()
    } catch (e) {
      alert(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ borderLeft: "3px solid var(--accent-amber)" }}>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <div>
          <div className="row gap4" style={{ marginBottom: 4 }}>
            <span className="badge badge-escalated">escalated</span>
            <span className="mono" style={{ fontSize: 10 }}>task: {approval.taskId.slice(0, 10)}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
            agent: {approval.agentId} · {timeAgo(approval.createdAt)}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm ml-auto"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Less ↑" : "Details ↓"}
        </button>
      </div>

      {/* Escalation reason */}
      <div style={{ marginBottom: 12 }}>
        <span className="label">{approval.action} — {approval.tier}</span>
        <p style={{
          fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6,
          background: "var(--bg-raised)", borderRadius: 8, padding: "10px 12px",
        }}>
          {approval.description}
        </p>
      </div>

      {/* Context (expanded) */}
      {expanded && approval.context && (
        <div style={{ marginBottom: 12 }}>
          <span className="label">Context</span>
          <div style={{
            background: "var(--bg-void)", border: "1px solid var(--bg-border)",
            borderRadius: 8, padding: "10px 12px",
            fontFamily: "'Fira Code', monospace", fontSize: 12,
            color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            lineHeight: 1.6, maxHeight: 200, overflowY: "auto",
          }}>
            {JSON.stringify(approval.context, null, 2)}
          </div>
        </div>
      )}

      <div className="divider" />

      {/* Note + decision */}
      <div className="form-field" style={{ marginBottom: 12 }}>
        <label className="label">Note (optional)</label>
        <input
          className="input"
          placeholder="Add context for the agent..."
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          disabled={busy}
          className="btn btn-danger"
          onClick={() => decide(false)}
        >
          ✕ Reject
        </button>
        <button
          disabled={busy}
          className="btn btn-success"
          onClick={() => decide(true)}
        >
          ✓ Approve
        </button>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace", marginLeft: "auto" }}>
          waiting {timeAgo(approval.createdAt)}
        </span>
      </div>
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
