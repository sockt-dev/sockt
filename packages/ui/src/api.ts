import type { Task, AgentConfig, MemoryEntry, ApprovalRequest, CadvpEvent, CadvpStats, HealthStats, TaskStatus } from "./types"

export const getOrchUrl  = () => localStorage.getItem("orchUrl")  ?? "http://localhost:3000"
export const getTenantId = () => localStorage.getItem("tenantId") ?? "default"

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getOrchUrl()}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  // ── Health ──────────────────────────────────────────────────────────
  health: () => req<HealthStats>("/health"),

  // ── Tasks ────────────────────────────────────────────────────────────
  getTasks: (status?: TaskStatus) => {
    const params = new URLSearchParams({ tenantId: getTenantId() })
    if (status) params.set("status", status)
    return req<Task[]>(`/tasks?${params}`)
  },

  getTask: (id: string) => req<Task>(`/tasks/${id}`),

  createTask: (data: { description: string; llmCallsBudget?: number; parentId?: string }) =>
    req<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify({ ...data, tenantId: getTenantId() }),
    }),

  cancelTask: (id: string) =>
    req<Task>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    }),

  requeueTask: (id: string) =>
    req<Task>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    }),

  // ── Agents ───────────────────────────────────────────────────────────
  getAgents: () => req<AgentConfig[]>(`/agents?tenantId=${getTenantId()}`),

  registerAgent: (data: Omit<AgentConfig, "id">) =>
    req<AgentConfig>("/agents/register", {
      method: "POST",
      body: JSON.stringify({ ...data, tenantId: getTenantId() }),
    }),

  deleteAgent: (id: string) => req<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),

  // ── Approvals ────────────────────────────────────────────────────────
  getPendingApprovals: () => req<ApprovalRequest[]>("/approvals/pending"),

  decide: (id: string, approved: boolean, note?: string) =>
    req<ApprovalRequest>(`/approvals/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({
        status: approved ? "approved" : "rejected",
        reason: note,
      }),
    }),

  // ── Memory (stub — implement when @sockt/memory exposes HTTP) ────────
  searchMemory: (_query: string, _topK = 10): Promise<MemoryEntry[]> =>
    Promise.resolve([]),

  deleteMemory: (_id: string): Promise<void> =>
    Promise.resolve(),

  // ── CADVP (stub — implement when @sockt/cadvp exposes HTTP) ─────────
  getCadvpEvents: (_limit = 50): Promise<CadvpEvent[]> =>
    Promise.resolve([]),

  getCadvpStats: (): Promise<CadvpStats> =>
    Promise.resolve({ eventsToday: 0, duplicatesFiltered: 0, entriesWritten: 0, lastFlush: null }),

  patchCadvpConfig: (_config: object): Promise<void> =>
    Promise.resolve(),
}
