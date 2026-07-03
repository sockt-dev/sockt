import React, { useState, useEffect, useCallback } from "react"
import type { AgentConfig, AgentRole, LlmProvider } from "../types"
import { api } from "../api"
import { getTenantId } from "../api"

const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "google", "ollama"]
const MODELS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
  openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-preview"],
  google:    ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  ollama:    ["llama3", "mistral", "mixtral", "phi3", "qwen2"],
}
const COMMON_TOOLS = ["web_search", "write_file", "read_file", "create_task", "exec_code", "http_request", "memory_query"]

export default function AgentRegistry() {
  const [agents,  setAgents]  = useState<AgentConfig[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<AgentConfig | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getAgents()
      setAgents(data); setError(null)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [load])

  const openCreate = () => { setEditing(null); setPanelOpen(true) }
  const openEdit   = (a: AgentConfig) => { setEditing(a); setPanelOpen(true) }
  const closePanel = () => { setPanelOpen(false); setEditing(null) }

  const handleDelete = async (id: string) => {
    if (!confirm("Deregister this agent?")) return
    try { await api.deleteAgent(id); load() }
    catch (e) { alert(String(e)) }
  }

  return (
    <div>
      <div className="page-header row">
        <div>
          <h1>Agents</h1>
          <p>Registered agents and their configurations</p>
        </div>
        <button className="btn btn-primary ml-auto" onClick={openCreate}>
          + Register Agent
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading">Loading agents...</div>
        ) : agents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <div>No agents registered</div>
            <div style={{ fontSize: 12 }}>Register an agent to start running tasks</div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={openCreate}>
              Register first agent
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Tools</th>
                  <th>Max tasks</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{agent.name}</div>
                      <div className="mono" style={{ fontSize: 10, marginTop: 2 }}>{agent.id.slice(0, 10)}</div>
                    </td>
                    <td><span className={`badge badge-${agent.role}`}>{agent.role}</span></td>
                    <td><span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{agent.department ?? "—"}</span></td>
                    <td><span className={`badge badge-${agent.llmConfig.provider}`}>{agent.llmConfig.provider}</span></td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{agent.llmConfig.model}</span></td>
                    <td>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {agent.tools.length > 0
                          ? agent.tools.slice(0, 2).join(", ") + (agent.tools.length > 2 ? ` +${agent.tools.length - 2}` : "")
                          : "—"}
                      </span>
                    </td>
                    <td><span className="mono">{agent.maxConcurrentTasks ?? "∞"}</span></td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(agent)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(agent.id)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {panelOpen && (
        <>
          <div className="panel-overlay" onClick={closePanel} />
          <AgentPanel
            initial={editing}
            onClose={closePanel}
            onSave={() => { closePanel(); load() }}
          />
        </>
      )}
    </div>
  )
}

/* ── Agent Form Panel ──────────────────────────────────────────────── */
function AgentPanel({ initial, onClose, onSave }: {
  initial: AgentConfig | null
  onClose: () => void
  onSave: () => void
}) {
  const isEdit = !!initial
  const [name,       setName]       = useState(initial?.name ?? "")
  const [role,       setRole]       = useState<AgentRole>(initial?.role ?? "worker")
  const [dept,       setDept]       = useState(initial?.department ?? "")
  const [provider,   setProvider]   = useState<LlmProvider>(initial?.llmConfig.provider ?? "anthropic")
  const [model,      setModel]      = useState(initial?.llmConfig.model ?? MODELS.anthropic[0])
  const [temp,       setTemp]       = useState(String(initial?.llmConfig.temperature ?? 0.7))
  const [prompt,     setPrompt]     = useState(initial?.systemPrompt ?? "")
  const [tools,      setTools]      = useState<string[]>(initial?.tools ?? [])
  const [customTool, setCustomTool] = useState("")
  const [maxTasks,   setMaxTasks]   = useState(String(initial?.maxConcurrentTasks ?? ""))
  const [busy,       setBusy]       = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const toggleTool = (t: string) =>
    setTools(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

  const addCustomTool = () => {
    if (customTool.trim() && !tools.includes(customTool.trim())) {
      setTools(prev => [...prev, customTool.trim()])
      setCustomTool("")
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !prompt.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.registerAgent({
        tenantId: getTenantId(),
        name: name.trim(),
        role,
        department: dept.trim() || undefined,
        llmConfig: { provider, model, temperature: parseFloat(temp) || 0.7 },
        systemPrompt: prompt.trim(),
        tools,
        maxConcurrentTasks: maxTasks ? parseInt(maxTasks) : undefined,
      })
      onSave()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{isEdit ? "Edit Agent" : "Register Agent"}</h2>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={submit} className="col" style={{ gap: 14, flex: 1 }}>

        <div className="form-grid">
          <div className="form-field">
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. planner-1" />
          </div>
          <div className="form-field">
            <label className="label">Role *</label>
            <select className="select input" value={role} onChange={e => setRole(e.target.value as AgentRole)}>
              <option value="worker">worker</option>
              <option value="architect">architect</option>
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="label">Department</label>
          <input className="input" value={dept} onChange={e => setDept(e.target.value)} placeholder="e.g. growth, ops, product" />
        </div>

        <div className="divider" />

        <div className="form-grid">
          <div className="form-field">
            <label className="label">LLM Provider *</label>
            <select
              className="select input"
              value={provider}
              onChange={e => {
                const p = e.target.value as LlmProvider
                setProvider(p)
                setModel(MODELS[p][0])
              }}
            >
              {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="label">Model *</label>
            <select className="select input" value={model} onChange={e => setModel(e.target.value)}>
              {MODELS[provider].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="label">Temperature</label>
            <input className="input input-mono" type="number" min={0} max={2} step={0.1} value={temp} onChange={e => setTemp(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="label">Max concurrent tasks</label>
            <input className="input input-mono" type="number" min={1} value={maxTasks} onChange={e => setMaxTasks(e.target.value)} placeholder="unlimited" />
          </div>
        </div>

        <div className="divider" />

        <div className="form-field">
          <label className="label">System Prompt *</label>
          <textarea
            className="textarea input-mono"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="You are a specialized agent that..."
            rows={5}
          />
        </div>

        <div className="form-field">
          <label className="label">Tools</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {COMMON_TOOLS.map(t => (
              <button
                key={t} type="button"
                className={`btn btn-sm ${tools.includes(t) ? "btn-primary" : "btn-ghost"}`}
                onClick={() => toggleTool(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input input-mono flex1"
              value={customTool}
              onChange={e => setCustomTool(e.target.value)}
              placeholder="custom_tool_name"
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCustomTool())}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCustomTool}>Add</button>
          </div>
          {tools.length > 0 && (
            <div className="mono" style={{ marginTop: 6, fontSize: 11, color: "var(--accent-green)" }}>
              Active: {tools.join(", ")}
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !prompt.trim()}>
            {busy ? "Saving..." : isEdit ? "Update Agent" : "Register Agent"}
          </button>
        </div>
      </form>
    </div>
  )
}
