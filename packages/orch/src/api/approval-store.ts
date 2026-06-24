import type { ApprovalStatus } from "@sockt/types";

export interface StoredApproval {
  id: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  tier: string;
  action: string;
  description: string;
  context?: Record<string, unknown>;
  status: ApprovalStatus;
  decidedBy?: string;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
}

let counter = 0;

export class ApprovalStore {
  private approvals = new Map<string, StoredApproval>();

  create(request: {
    tenantId: string;
    agentId: string;
    taskId: string;
    tier: string;
    action: string;
    description: string;
    context?: Record<string, unknown>;
  }): StoredApproval {
    const id = `approval-${++counter}`;
    const approval: StoredApproval = {
      ...request,
      id,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(id, approval);
    return approval;
  }

  get(id: string): StoredApproval | undefined {
    return this.approvals.get(id);
  }

  decide(id: string, decision: { status: ApprovalStatus; decidedBy?: string; reason?: string }): StoredApproval | undefined {
    const approval = this.approvals.get(id);
    if (!approval) return undefined;
    approval.status = decision.status;
    approval.decidedBy = decision.decidedBy;
    approval.reason = decision.reason;
    approval.decidedAt = new Date().toISOString();
    return approval;
  }
}
