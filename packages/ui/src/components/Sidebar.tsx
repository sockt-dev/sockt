import React from "react"
import type { Route } from "../types"

interface Props {
  current: Route
  onNavigate: (r: Route) => void
  pendingApprovals: number
  orchOnline: boolean | null
}

const nav: { route: Route; label: string; icon: React.ReactNode }[] = [
  { route: "dashboard", label: "Dashboard",  icon: <IconGrid /> },
  { route: "tasks",     label: "Tasks",      icon: <IconList /> },
  { route: "agents",    label: "Agents",     icon: <IconUsers /> },
  { route: "memory",    label: "Memory",     icon: <IconBrain /> },
  { route: "approvals", label: "Approvals",  icon: <IconCheck /> },
  { route: "cadvp",     label: "Monitor",    icon: <IconActivity /> },
  { route: "settings",  label: "Settings",   icon: <IconGear /> },
]

export default function Sidebar({ current, onNavigate, pendingApprovals, orchOnline }: Props) {
  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      background: "var(--bg-surface)",
      borderRight: "1px solid var(--bg-border)",
      display: "flex",
      flexDirection: "column",
      padding: "20px 12px",
      gap: 4,
    }}>
      {/* Logo */}
      <div style={{ padding: "0 8px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <SocktLogo />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          sockt
        </span>
        <span style={{
          marginLeft: "auto", fontSize: 9, fontFamily: "'Fira Code', monospace",
          background: "var(--bg-raised)", border: "1px solid var(--bg-border)",
          borderRadius: 999, padding: "1px 6px", color: "var(--text-secondary)",
        }}>
          OSS
        </span>
      </div>

      {/* Nav links */}
      {nav.map(({ route, label, icon }) => {
        const active = current === route
        const hasBadge = route === "approvals" && pendingApprovals > 0
        return (
          <button
            key={route}
            onClick={() => onNavigate(route)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8,
              background: active ? "var(--bg-raised)" : "transparent",
              border: active ? "1px solid var(--bg-border)" : "1px solid transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 13, fontWeight: active ? 500 : 400,
              fontFamily: "inherit",
              transition: "all var(--dur-fast) var(--ease-expo)",
              width: "100%", textAlign: "left",
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-primary)" }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)" }}
          >
            <span style={{ opacity: active ? 1 : 0.6, display: "flex", alignItems: "center" }}>{icon}</span>
            <span style={{ flex: 1 }}>{label}</span>
            {hasBadge && (
              <span style={{
                background: "var(--accent-amber)", color: "var(--bg-void)",
                borderRadius: 999, fontSize: 10, fontWeight: 700,
                padding: "0 5px", minWidth: 16, textAlign: "center",
                fontFamily: "'Fira Code', monospace",
              }}>
                {pendingApprovals}
              </span>
            )}
          </button>
        )
      })}

      {/* Orch status */}
      <div style={{ marginTop: "auto", padding: "12px 8px 0", borderTop: "1px solid var(--bg-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: orchOnline === null ? "var(--text-secondary)" : orchOnline ? "var(--accent-green)" : "var(--accent-red)",
            flexShrink: 0,
            ...(orchOnline === null ? { animation: "pulse 1.5s ease-in-out infinite" } : {}),
          }} />
          {orchOnline === null ? "connecting..." : orchOnline ? "orchestrator online" : "orchestrator offline"}
        </div>
      </div>
    </aside>
  )
}

/* ── Inline SVG Icons (16×16) ─────────────────────────────────────── */
function IconGrid() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
}
function IconList() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
}
function IconUsers() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function IconBrain() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66Z"/></svg>
}
function IconCheck() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}
function IconActivity() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
function IconGear() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
function SocktLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="var(--text-primary)" />
      <path d="M8 12h16M8 16h10M8 20h13" stroke="var(--bg-void)" strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  )
}
