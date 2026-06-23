import type { ApprovalRequest, ApprovalDecision } from "../schemas/hitl.schema.ts";
import type { ApprovalStatus } from "../types/hitl.ts";

export interface HitlGate {
  requestApproval(request: ApprovalRequest): Promise<string>;
  checkApproval(requestId: string): Promise<ApprovalStatus>;
  waitForApproval(requestId: string, timeoutMs: number): Promise<ApprovalDecision>;
  listPending(tenantId: string): Promise<ApprovalRequest[]>;
}
