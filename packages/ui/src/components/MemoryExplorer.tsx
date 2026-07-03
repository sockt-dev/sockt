import React, { useState, useCallback } from "react"
import type { MemoryEntry } from "../types"
import { api } from "../api"

const CATEGORY_COLORS: Record<string, string> = {
  research:    "var(--accent-blue)",
  decision:    "var(--accent-purple)",
  observation: "var(--accent-green)",
  error:       "var(--accent-red)",
  context:     "var(--accent-amber)",
}

export default function MemoryExplorer() {
  const [query,   setQuery]   = useState("")
  const [results, setResults] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true); setError(null)
    try {
      const data = await api.searchMemory(query.trim())
      setResults(data); setSearched(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [query])

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this memory entry?")) return
    try {
      await api.deleteMemory(id)
      setResults(prev => prev.filter(r => r.id !== id))
    } catch (e) { alert(String(e)) }
  }

  const catColor = (cat: string) => CATEGORY_COLORS[cat.toLowerCase()] ?? "var(--text-secondary)"

  return (
    <div>
      <div className="page-header">
        <h1>Memory</h1>
        <p>Semantic search over agent knowledge base</p>
      </div>

      {/* Search bar */}
      <form onSubmit={search} className="row" style={{ gap: 8, marginBottom: 24 }}>
        <input
          className="input flex1"
          placeholder='Search memory — e.g. "competitor pricing strategies"'
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ fontSize: 14, padding: "10px 14px" }}
        />
        <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Results */}
      {!searched && !loading && (
        <div className="empty-state">
          <div className="empty-icon">◎</div>
          <div>Enter a query above</div>
          <div style={{ fontSize: 12 }}>
            Memory is written automatically by the CADVP daemon as agents execute tasks.
          </div>
        </div>
      )}

      {searched && results.length === 0 && !loading && (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <div>No results for "{query}"</div>
          <div style={{ fontSize: 12 }}>Try a different query or wait for agents to build more memory.</div>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>
            {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
          </div>
          <div className="col" style={{ gap: 8 }}>
            {results.map(entry => (
              <MemoryCard key={entry.id} entry={entry} catColor={catColor} onDelete={handleDelete} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MemoryCard({ entry, catColor, onDelete }: {
  entry: MemoryEntry
  catColor: (c: string) => string
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = entry.content.length > 200

  return (
    <div className="card" style={{ cursor: "default" }}>
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <span
          className="badge"
          style={{ background: catColor(entry.category) + "22", color: catColor(entry.category) }}
        >
          {entry.category}
        </span>
        {entry.score !== undefined && (
          <span className="mono" style={{ fontSize: 10 }}>
            {Math.round(entry.score * 100)}% match
          </span>
        )}
        <div className="row ml-auto" style={{ gap: 6 }}>
          <span className="mono" style={{ fontSize: 10 }}>{entry.agentId.slice(0, 12)}</span>
          <span style={{ color: "var(--bg-border)" }}>·</span>
          <span className="mono" style={{ fontSize: 10 }}>{timeAgo(entry.createdAt)}</span>
        </div>
      </div>

      <p style={{
        fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6,
        fontFamily: "'Fira Code', monospace",
        whiteSpace: "pre-wrap",
        display: isLong && !expanded ? "-webkit-box" : undefined,
        WebkitLineClamp: isLong && !expanded ? 4 : undefined,
        WebkitBoxOrient: isLong && !expanded ? "vertical" as const : undefined,
        overflow: isLong && !expanded ? "hidden" : undefined,
      }}>
        {entry.content}
      </p>

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        {isLong && (
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <button
          className="btn btn-danger btn-sm ml-auto"
          onClick={() => onDelete(entry.id)}
          style={{ opacity: 0.6 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}
        >
          Delete
        </button>
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
