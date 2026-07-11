import type { OrchClient, Task, TaskCreate } from "@sockt/types";
import { SocktError } from "@sockt/types";

export interface HttpOrchClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  /** Sent as `Authorization: Bearer <apiToken>` when set — must match the
   * orch process's own ORCH_API_TOKEN (see OrchestratorApi's apiToken doc).
   * Unset by default, matching orch's own no-auth-by-default behavior. */
  apiToken?: string;
}

export class HttpOrchClient implements OrchClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly apiToken?: string;

  constructor(config: HttpOrchClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.retries = config.retries ?? 2;
    this.apiToken = config.apiToken;
  }

  async claim(taskId: string, agentId: string): Promise<Task> {
    return this.post<Task>(`/tasks/${taskId}/claim`, { agentId });
  }

  async complete(taskId: string, output: string, agentId: string): Promise<void> {
    await this.post(`/tasks/${taskId}/complete`, { output, agentId });
  }

  async escalate(taskId: string, reason: string, agentId: string): Promise<void> {
    await this.post(`/tasks/${taskId}/escalate`, { reason, agentId });
  }

  async block(taskId: string, dependency: string, agentId: string): Promise<void> {
    await this.post(`/tasks/${taskId}/block`, { dependency, agentId });
  }

  async requestInput(taskId: string, question: string, agentId: string): Promise<void> {
    await this.post(`/tasks/${taskId}/request-input`, { question, agentId });
  }

  async recordLlmCall(taskId: string): Promise<{ allowed: boolean; remaining: number }> {
    return this.post<{ allowed: boolean; remaining: number }>(`/tasks/${taskId}/record-llm-call`, {});
  }

  async listPending(tenantId: string): Promise<Task[]> {
    return this.get<Task[]>(`/tasks?tenantId=${encodeURIComponent(tenantId)}&status=pending`);
  }

  async createTask(task: TaskCreate): Promise<Task> {
    return this.post<Task>("/tasks", task);
  }

  async registerAgent(agent: import("@sockt/types").AgentConfig): Promise<void> {
    await this.post("/agents/register", agent);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const headers: Record<string, string> = {};
        if (body) headers["Content-Type"] = "application/json";
        if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;

        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }

        if (this.isRetryable(response.status) && attempt < this.retries) {
          lastError = new Error(`HTTP ${response.status}`);
          await this.backoff(attempt);
          continue;
        }

        const text = await response.text().catch(() => "");
        throw new SocktError(
          `Orch API error: ${response.status} ${method} ${path}`,
          "ORCH_ERROR",
          { status: response.status, body: text },
        );
      } catch (error) {
        if (error instanceof SocktError) throw error;

        if (attempt < this.retries) {
          lastError = error;
          await this.backoff(attempt);
          continue;
        }

        throw new SocktError(
          `Orch request failed after ${this.retries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`,
          "ORCH_ERROR",
          { path, lastError: String(lastError) },
        );
      }
    }

    throw new SocktError("Orch request failed: max retries exhausted", "ORCH_ERROR", { path });
  }

  private isRetryable(status: number): boolean {
    return status >= 500 || status === 429;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(100 * 2 ** attempt, 5000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
