import type { Task, TaskCreate } from "../schemas/task.schema.ts";

export interface OrchClient {
  claim(taskId: string, agentId: string): Promise<Task>;
  // agentId is required (not optional) on complete/escalate/block: the orch
  // routes use it to release the in-memory LockManager lock acquired at claim
  // time. Previously these methods never sent it, so the server fell back to
  // releasing under a literal "unknown" key — the real agent's lock entry was
  // never freed, and isAtCapacity() would eventually (silently) refuse new
  // claims for that agent as stale entries accumulated. Found 2026-07-12
  // while wiring the HITL block() path through the same code.
  complete(taskId: string, output: string, agentId: string): Promise<void>;
  escalate(taskId: string, reason: string, agentId: string): Promise<void>;
  /** Transitions in_progress -> blocked (e.g. HITL denial/timeout, or awaiting
   * a clarifying-question answer). Unlike complete/escalate this is not
   * terminal — blocked -> pending is a legal FSM transition, so the task can
   * be unblocked and re-claimed later. */
  block(taskId: string, dependency: string, agentId: string): Promise<void>;
  /** Transitions in_progress -> blocked and records a clarifying question that
   * needs a human answer, posted to the thread that originated the task. Like
   * block(), not terminal — answering resumes the task via blocked -> pending. */
  requestInput(taskId: string, question: string, agentId: string): Promise<void>;
  recordLlmCall(taskId: string): Promise<{ allowed: boolean; remaining: number }>;
  listPending(tenantId: string): Promise<Task[]>;
  createTask(task: TaskCreate): Promise<Task>;
}
