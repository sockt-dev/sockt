import type { HitlGate, ApprovalRequest, ApprovalDecision, ApprovalStatus } from "@sockt/types";
import { SocktError } from "@sockt/types";

export interface HttpHitlGateConfig {
  baseUrl: string;
  pollIntervalMs?: number;
  /** Sent as `Authorization: Bearer <apiToken>` when set — see
   * HttpOrchClientConfig.apiToken for the matching rationale. */
  apiToken?: string;
}

interface ApprovalRecord {
  id: string;
  status: ApprovalStatus;
  decidedBy?: string;
  reason?: string;
  decidedAt?: string;
}

/** Polls orch's /approvals endpoints (backed by ApprovalStore's sqlite table)
 * for a decision. There's no push channel from orch to a runtime worker, so
 * waitForApproval polls rather than blocking on a webhook/websocket. */
export class HttpHitlGate implements HitlGate {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly apiToken?: string;

  constructor(config: HttpHitlGateConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.apiToken = config.apiToken;
  }

  async requestApproval(request: ApprovalRequest): Promise<string> {
    const approval = await this.post<ApprovalRecord>("/approvals", request);
    return approval.id;
  }

  async checkApproval(requestId: string): Promise<ApprovalStatus> {
    const approval = await this.get<ApprovalRecord>(`/approvals/${requestId}`);
    return approval.status;
  }

  async waitForApproval(requestId: string, timeoutMs: number): Promise<ApprovalDecision> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const approval = await this.get<ApprovalRecord>(`/approvals/${requestId}`);
      if (approval.status !== "pending") {
        return {
          status: approval.status,
          decidedBy: approval.decidedBy,
          reason: approval.reason,
          decidedAt: approval.decidedAt,
        };
      }

      if (Date.now() >= deadline) {
        // Client-side deadline reached with the server row still "pending".
        // Returned as a local timeout regardless of server state — orch's
        // own sweepTimeouts() will eventually mark the row timed out too
        // (see ApprovalStore), but the caller shouldn't block on that.
        return { status: "timeout" };
      }

      await Bun.sleep(Math.min(this.pollIntervalMs, Math.max(deadline - Date.now(), 0)) || this.pollIntervalMs);
    }
  }

  async listPending(tenantId: string): Promise<ApprovalRequest[]> {
    const rows = await this.get<Array<ApprovalRecord & { tenantId: string; agentId: string; taskId: string; tier: string; action: string; description: string }>>(
      `/approvals/pending?tenantId=${encodeURIComponent(tenantId)}`,
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      agentId: row.agentId,
      taskId: row.taskId,
      tier: row.tier as ApprovalRequest["tier"],
      action: row.action,
      description: row.description,
    }));
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new SocktError(
        `Hitl API error: ${response.status} ${method} ${path}`,
        "HITL_ERROR",
        { status: response.status, body: text },
      );
    }

    return (await response.json()) as T;
  }
}
