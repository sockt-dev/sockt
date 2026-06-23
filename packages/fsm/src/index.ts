// ─── Classes ─────────────────────────────────────────────────────────────────
export { SqliteTaskStore } from "./store/sqlite-task-store.ts";
export { FsmEngine } from "./fsm/engine.ts";
export { TaskClaimLock } from "./lock/task-claim-lock.ts";

// ─── Functions ───────────────────────────────────────────────────────────────
export { initializeSchema } from "./store/schema.ts";
export { createTestDb } from "./util/test-db.ts";

// ─── Types ───────────────────────────────────────────────────────────────────
export type { BudgetCheckResult, CreationValidation, FsmTransitionRule } from "./fsm/budget.ts";

// ─── Transition Table ────────────────────────────────────────────────────────
export { TRANSITIONS, canTransition } from "./fsm/transitions.ts";
