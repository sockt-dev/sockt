export const HitlTier = {
  Notify: "notify",
  Confirm: "confirm",
  Review: "review",
} as const;
export type HitlTier = (typeof HitlTier)[keyof typeof HitlTier];
export const HITL_TIER_VALUES = Object.values(HitlTier) as [HitlTier, ...HitlTier[]];

export const ApprovalStatus = {
  Pending: "pending",
  Approved: "approved",
  Denied: "denied",
  Timeout: "timeout",
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];
export const APPROVAL_STATUS_VALUES = Object.values(ApprovalStatus) as [ApprovalStatus, ...ApprovalStatus[]];
