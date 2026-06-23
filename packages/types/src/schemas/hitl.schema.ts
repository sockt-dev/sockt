import { z } from "zod";
import { HITL_TIER_VALUES, APPROVAL_STATUS_VALUES } from "../types/hitl.ts";

export const ApprovalRequestSchema = z.object({
  id: z.string().optional(),
  tenantId: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  tier: z.enum(HITL_TIER_VALUES),
  action: z.string(),
  description: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalDecisionSchema = z.object({
  status: z.enum(APPROVAL_STATUS_VALUES),
  decidedBy: z.string().optional(),
  reason: z.string().optional(),
  decidedAt: z.string().datetime().optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
