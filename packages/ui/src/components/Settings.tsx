import React, { useState, useEffect } from "react"
import { api, getOrchUrl, getTenantId } from "../api"

export default function Settings() {
  const [orchUrl,  setOrchUrl]  = useState(getOrchUrl())
  const [tenantId, setTenantId] = useState(getTenantId())
  const [saved,    setSaved]    = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null)

  const save = () => {
    localStorage.setItem("orchUrl",  orchUrl.trim())
    localStorage.setItem("tenantId", tenantId.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const testConnection = async () => {
    setTesting(true); setTestResult(null)
    // Temporarily write to localStorage so api.ts picks up the new URL
    const prev = localStorage.getItem("orchUrl")
    localStorage.setItem("orchUrl", orchUrl.trim())
    try {
      await api.health()
      setTestResult("ok")
    } catch {
      setTestResult("fail")
    } finally {
      // Restore previous value if not yet saved
      if (!saved && prev !== null) localStorage.setItem("orchUrl", prev)
      setTesting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Configure the connection to your local orchestrator</p>
      </div>

      <div style={{ maxWidth: 560 }} className="col" style={{ gap: 24 }}>

        {/* Connection */}
        <div className="card-lg card">
          <h2 style={{ marginBottom: 4 }}>Orchestrator</h2>
          <p style={{ fontSize: 13, marginBottom: 20 }}>
            The Hono HTTP server started by <span className="mono">@sockt/orch</span>. Defaults to port 3000.
          </p>

          <div className="col" style={{ gap: 14 }}>
            <div className="form-field">
              <label className="label">Orchestrator URL</label>
              <input
                className="input input-mono"
                value={orchUrl}
                onChange={e => setOrchUrl(e.target.value)}
                placeholder="http://localhost:3000"
              />
            </div>

            <div className="form-field">
              <label className="label">Tenant ID</label>
              <input
                className="input input-mono"
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                placeholder="default"
              />
              <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'Fira Code', monospace" }}>
                All API calls are scoped to this tenant
              </span>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? "Testing..." : "Test connection"}
              </button>
              {testResult === "ok" && (
                <span style={{ color: "var(--accent-green)", fontSize: 12, fontFamily: "'Fira Code', monospace" }}>
                  ✓ Connected
                </span>
              )}
              {testResult === "fail" && (
                <span style={{ color: "var(--accent-red)", fontSize: 12, fontFamily: "'Fira Code', monospace" }}>
                  ✕ Cannot reach orchestrator
                </span>
              )}
              <button
                className={`btn ml-auto ${saved ? "btn-success" : "btn-primary"}`}
                onClick={save}
              >
                {saved ? "✓ Saved" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* How to start */}
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Start the system</h3>
          <div className="col" style={{ gap: 8 }}>
            <Step n={1} label="Install dependencies">
              <code>bun install</code>
            </Step>
            <Step n={2} label="Start the orchestrator">
              <code>bun run packages/orch/src/index.ts</code>
            </Step>
            <Step n={3} label="Start the CADVP daemon (optional)">
              <code>bun run packages/cadvp/src/index.ts</code>
            </Step>
            <Step n={4} label="Register agents in the Agents tab and create tasks" />
          </div>
        </div>

        {/* Environment */}
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Environment variables</h3>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Set these before starting the orchestrator. Bun auto-loads <span className="mono">.env</span>.
          </p>
          <div style={{
            background: "var(--bg-void)", border: "1px solid var(--bg-border)",
            borderRadius: 8, padding: "12px 14px",
            fontFamily: "'Fira Code', monospace", fontSize: 12,
            color: "var(--text-mono)", lineHeight: 2,
          }}>
            <EnvLine k="PORT"          v="3000"                   comment="Orchestrator port" />
            <EnvLine k="ANTHROPIC_API_KEY" v="sk-ant-..."         comment="If using Anthropic" />
            <EnvLine k="OPENAI_API_KEY"    v="sk-..."             comment="If using OpenAI" />
            <EnvLine k="GOOGLE_API_KEY"    v="..."                comment="If using Gemini" />
            <EnvLine k="OLLAMA_BASE_URL"   v="http://localhost:11434" comment="If using Ollama" />
            <EnvLine k="DB_PATH"           v="./sockt.db"         comment="SQLite file path" />
          </div>
        </div>

        {/* About */}
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3>Sockt OSS</h3>
            <span className="badge" style={{ background: "rgba(34,208,122,.1)", color: "var(--accent-green)", marginLeft: 8 }}>
              FSL-1.1-MIT
            </span>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>
            This is the open-source control plane for Sockt agent swarms. Free to use for non-competing
            purposes. Converts to MIT automatically 2 years after each release.
          </p>
          <div className="divider" />
          <div className="row" style={{ gap: 16, fontSize: 12, fontFamily: "'Fira Code', monospace" }}>
            <a href="https://github.com/aliaankhowaja/sockt" target="_blank" rel="noreferrer"
               style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
              github →
            </a>
            <span style={{ color: "var(--text-secondary)" }}>
              UI v0.1.0
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              packages: types · fsm · memory · orch · runtime · cadvp
            </span>
          </div>
        </div>

      </div>
    </div>
  )
}

function Step({ n, label, children }: { n: number; label: string; children?: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
        background: "var(--bg-raised)", border: "1px solid var(--bg-border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontFamily: "'Fira Code', monospace", color: "var(--text-secondary)",
      }}>{n}</span>
      <div className="col" style={{ gap: 4, flex: 1, padding: "2px 0" }}>
        <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</span>
        {children && (
          <div style={{
            background: "var(--bg-void)", border: "1px solid var(--bg-border)",
            borderRadius: 6, padding: "5px 10px",
            fontFamily: "'Fira Code', monospace", fontSize: 12,
            color: "var(--accent-green)",
          }}>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

function EnvLine({ k, v, comment }: { k: string; v: string; comment: string }) {
  return (
    <div>
      <span style={{ color: "var(--accent-blue)" }}>{k}</span>
      <span style={{ color: "var(--text-secondary)" }}>=</span>
      <span style={{ color: "var(--accent-green)" }}>{v}</span>
      <span style={{ color: "var(--bg-border)", marginLeft: 12 }}># {comment}</span>
    </div>
  )
}
