export type TaskStatus = "pending" | "in_progress" | "completed" | "escalated" | "blocked" | "cancelled"
export type AgentRole  = "architect" | "worker"
export type LlmProvider = "anthropic" | "openai" | "google" | "ollama"

export interface Task {
  id: string
  tenantId: string
  status: TaskStatus
  owner?: string
  parentId?: string
  description: string
  output?: string
  llmCallsUsed: number
  llmCallsBudget: number
  attemptCount: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
}

export interface LlmConfig {
  provider: LlmProvider
  model: string
  temperature?: number
  maxTokens?: number
}

export interface AgentConfig {
  id: string
  tenantId: string
  name: string
  role: AgentRole
  llmConfig: LlmConfig
  systemPrompt: string
  tools: string[]
  department?: string
  maxConcurrentTasks?: number
}

export interface MemoryEntry {
  id: string
  content: string
  category: string
  agentId: string
  tenantId: string
  createdAt: string
  score?: number
}

export interface ApprovalRequest {
  id: string
  taskId: string
  agentId: string
  tenantId: string
  tier: string
  action: string
  description: string
  context?: Record<string, unknown>
  status: "pending" | "approved" | "rejected"
  decidedBy?: string
  reason?: string
  createdAt: string
  decidedAt?: string
}

export interface CadvpEvent {
  id: string
  type: string
  agentId: string
  content: string
  timestamp: string
  dedupStatus: "stored" | "skipped"
  dedupScore?: number
}

export interface CadvpStats {
  eventsToday: number
  duplicatesFiltered: number
  entriesWritten: number
  lastFlush: string | null
}

export interface HealthStats {
  status: "ok" | "degraded" | "offline"
  tasks: Record<TaskStatus, number>
  agents: number
  uptime?: number
}

export type Route = "dashboard" | "tasks" | "agents" | "memory" | "approvals" | "cadvp" | "settings"
