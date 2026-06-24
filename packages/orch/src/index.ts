export { Orchestrator } from "./orchestrator.ts";
export { OrchestratorApi } from "./api/server.ts";
export { MessageRouter } from "./router/message-router.ts";
export { Scheduler } from "./scheduler/scheduler.ts";
export { LockManager } from "./lock/lock-manager.ts";
export { AgentRegistry } from "./registry/agent-registry.ts";
export { DepartmentManager } from "./registry/department-manager.ts";

export type { OrchestratorConfig, OrchestratorHealth, DepartmentConfig } from "./orchestrator.ts";
export type { ScheduleConfig } from "./scheduler/scheduler.ts";
export type { DepartmentTemplate } from "./registry/department-manager.ts";
export type { OrchestratorApiDeps } from "./api/server.ts";
