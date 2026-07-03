import React, { useState, useEffect, useCallback, useRef } from "react"
import type { CadvpEvent, CadvpStats } from "../types"
import { api } from "../api"

export default function CadvpMonitor() {
  const [events,  setEvents]  = useState<CadvpEvent[]>([])
  const [stats,   setStats]   = useState<CadvpStats | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [config, setConfig]   = useState({
    dedupThreshold: "0.92",
    batchSize:      "10",
    flushIntervalMs: "2000",
    pollIntervalMs:  "500",
  })
  const [configSaved, setConfigSaved] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const load = useCallback(async () => {
    try {
      const [evts, st] = await Promise.all([api.getCadvpEvents(80), api.getCadvpStats()])
      setEvents(evts); setStats(st); setError(null)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 1_000)
    return () => clearInterval(t)
  }, [load])

  // Auto-scroll feed to bottom on new events
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [events, autoScroll])

  const saveConfig = async () => {
    try {
      await api.patchCadvpConfig({
        dedupThreshold:  parseFloat(config.dedupThreshold),
        batchSize:       parseInt(config.batchSize),
        flushIntervalMs: parseInt(config.flushIntervalMs),
        pollIntervalMs:  parseInt(config.pollIntervalMs),
      })
      setConfigSaved(true)
      setTimeout(() => setConfigSaved(false), 2000)
    } catch (e) { alert(String(e)) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>CADVP Monitor</h1>
        <p>Continuous agent event ingestion and memory pipeline</p>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard value={stats?.eventsToday ?? "—"} label="Events today" />
        <StatCard value={stats?.duplicatesFiltered ?? "—"} label="Duplicates filtered" color="var(--accent-amber)" />
        <StatCard value={stats?.entriesWritten ?? "—"} label="Memory entries written" color="var(--accent-green)" />
        <StatCard
          value={stats?.lastFlush ? timeAgo(stats.lastFlush) : "—"}
          label="Last flush"
          color="var(--text-secondary)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>

        {/* Live event feed */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--bg-border)" }}>
            <h3>Live event feed</h3>
            <div className="row ml-auto" style={{ gap: 10 }}>
              <label className="row" style={{ gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={e => setAutoScroll(e.target.checked)}
                  style={{ accentColor: "var(--accent-green)" }}
                />
                auto-scroll
              </label>
              {!loading && (
                <span className="row" style={{ gap: 4, fontSize: 10, fontFamily: "'Fira Code', monospace", color: "var(--accent-green)" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-green)", animation: "pulse 1.5s ease-in-out infinite" }} />
                  live
                </span>
              )}
            </div>
          </div>

          {/* Column headers */}
          <div className="feed-row" style={{ borderBottom: "1px solid var(--bg-border)", padding: "6px 12px" }}>
            <span className="label" style={{ margin: 0 }}>Time</span>
            <span className="label" style={{ margin: 0 }}>Type</span>
            <span className="label" style={{ margin: 0 }}>Content</span>
            <span className="label" style={{ margin: 0 }}>Status</span>
          </div>

          <div
            ref={feedRef}
            className="feed"
            style={{ maxHeight: 460, overflowY: "auto", padding: "4px 0" }}
          >
            {loading && <div className="loading">Connecting to daemon...</div>}
            {!loading && events.length === 0 && (
              <div className="empty-state" style={{ padding: "24px" }}>
                <div className="empty-icon">◎</div>
                <div>No events yet</div>
                <div style={{ fontSize: 11 }}>CADVP daemon will appear here when agents start running</div>
              </div>
            )}
            {events.map((ev, i) => (
              <EventRow key={ev.id ?? i} event={ev} />
            ))}
          </div>
        </div>

        {/* Config panel */}
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Daemon config</h3>
          <div className="col" style={{ gap: 12 }}>
            <ConfigField
              label="Dedup threshold"
              hint="Cosine similarity — events above this are skipped"
              value={config.dedupThreshold}
              onChange={v => setConfig(c => ({ ...c, dedupThreshold: v }))}
              type="number" step="0.01" min="0" max="1"
            />
            <ConfigField
              label="Batch size"
              hint="Events per flush"
              value={config.batchSize}
              onChange={v => setConfig(c => ({ ...c, batchSize: v }))}
              type="number" min="1"
            />
            <ConfigField
              label="Flush interval (ms)"
              hint="How often to write batches to memory"
              value={config.flushIntervalMs}
              onChange={v => setConfig(c => ({ ...c, flushIntervalMs: v }))}
              type="number" min="100"
            />
            <ConfigField
              label="Poll interval (ms)"
              hint="How often to tail log files"
              value={config.pollIntervalMs}
              onChange={v => setConfig(c => ({ ...c, pollIntervalMs: v }))}
              type="number" min="100"
            />
          </div>
          <div className="divider" />
          <button
            className={`btn ${configSaved ? "btn-success" : "btn-primary"}`}
            style={{ width: "100%" }}
            onClick={saveConfig}
          >
            {configSaved ? "✓ Saved" : "Apply config"}
          </button>

          {/* Dedup visual */}
          <div style={{ marginTop: 16 }}>
            <span className="label">Dedup filter rate</span>
            {stats && (
              <>
                <div className="budget-bar" style={{ height: 6, marginBottom: 4 }}>
                  <div
                    className="budget-fill budget-mid"
                    style={{
                      width: `${stats.eventsToday > 0
                        ? (stats.duplicatesFiltered / stats.eventsToday) * 100
                        : 0}%`
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 10 }}>
                  {stats.eventsToday > 0
                    ? Math.round((stats.duplicatesFiltered / stats.eventsToday) * 100)
                    : 0}% of events filtered as duplicates
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventRow({ event }: { event: CadvpEvent }) {
  const stored = event.dedupStatus === "stored"
  return (
    <div className={`feed-row ${stored ? "feed-stored" : "feed-skipped"}`}>
      <span className="mono" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
        {formatTime(event.timestamp)}
      </span>
      <span style={{
        fontSize: 10, fontFamily: "'Fira Code', monospace",
        color: stored ? "var(--accent-blue)" : "var(--text-secondary)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {event.type}
      </span>
      <span style={{
        fontSize: 11, color: "var(--text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {event.content}
      </span>
      <span style={{
        fontSize: 10, fontFamily: "'Fira Code', monospace",
        color: stored ? "var(--accent-green)" : "var(--text-secondary)",
        textAlign: "right",
      }}>
        {stored ? "stored" : `skip ${event.dedupScore ? `(${Math.round(event.dedupScore * 100)}%)` : ""}`}
      </span>
    </div>
  )
}

function StatCard({ value, label, color = "var(--text-primary)" }: {
  value: string | number
  label: string
  color?: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color, fontSize: 22 }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function ConfigField({ label, hint, value, onChange, ...inputProps }: {
  label: string; hint: string; value: string; onChange: (v: string) => void
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="form-field" style={{ gap: 4 }}>
      <label className="label">{label}</label>
      <input
        className="input input-mono"
        value={value}
        onChange={e => onChange(e.target.value)}
        {...inputProps}
      />
      <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>{hint}</span>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch { return iso }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 10)  return "just now"
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}
