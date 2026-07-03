import React, { useState, useEffect, useCallback } from "react"
import { createRoot } from "react-dom/client"
import type { Route } from "./types"
import { api } from "./api"
import Sidebar from "./components/Sidebar"
import Dashboard from "./components/Dashboard"
import TaskBoard from "./components/TaskBoard"
import AgentRegistry from "./components/AgentRegistry"
import MemoryExplorer from "./components/MemoryExplorer"
import ApprovalsPanel from "./components/ApprovalsPanel"
import CadvpMonitor from "./components/CadvpMonitor"
import Settings from "./components/Settings"

function App() {
  const [route, setRoute] = useState<Route>("dashboard")
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [orchOnline, setOrchOnline] = useState<boolean | null>(null)

  // Hash-based routing
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace("#", "") as Route
      if (hash) setRoute(hash)
    }
    window.addEventListener("hashchange", sync)
    sync()
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  const navigate = useCallback((r: Route) => {
    window.location.hash = r
    setRoute(r)
  }, [])

  // Poll orchestrator health + approval count every 10s
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        await api.health()
        if (!cancelled) setOrchOnline(true)
        const approvals = await api.getPendingApprovals()
        if (!cancelled) setPendingApprovals(approvals.length)
      } catch {
        if (!cancelled) setOrchOnline(false)
      }
    }
    poll()
    const t = setInterval(poll, 10_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const views: Record<Route, React.ReactNode> = {
    dashboard: <Dashboard onNavigate={navigate} />,
    tasks:     <TaskBoard />,
    agents:    <AgentRegistry />,
    memory:    <MemoryExplorer />,
    approvals: <ApprovalsPanel />,
    cadvp:     <CadvpMonitor />,
    settings:  <Settings />,
  }

  return (
    <div className="app-shell">
      <Sidebar
        current={route}
        onNavigate={navigate}
        pendingApprovals={pendingApprovals}
        orchOnline={orchOnline}
      />
      <main className="page-main">
        {views[route]}
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<App />)
