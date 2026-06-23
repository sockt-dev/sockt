import type { Database, Statement } from "bun:sqlite";
import type { Task } from "@sockt/types";
import { TaskStoreError } from "@sockt/types";
import { now } from "../util/timestamp.ts";

interface TaskRow {
  id: string;
  tenant_id: string;
  status: string;
  owner: string | null;
  parent_id: string | null;
  description: string;
  output: string | null;
  llm_calls_used: number;
  llm_calls_budget: number;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status as Task["status"],
    owner: row.owner,
    parentId: row.parent_id,
    description: row.description,
    output: row.output,
    llmCallsUsed: row.llm_calls_used,
    llmCallsBudget: row.llm_calls_budget,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskClaimLock {
  private readonly claimStmt: Statement;
  private readonly releaseStmt: Statement;
  private readonly getStmt: Statement;

  constructor(db: Database) {
    this.claimStmt = db.prepare(`
      UPDATE tasks SET status = 'in_progress', owner = ?2, updated_at = ?3
      WHERE id = ?1 AND status = 'pending' AND owner IS NULL
      RETURNING *
    `);

    this.releaseStmt = db.prepare(`
      UPDATE tasks SET status = 'pending', owner = NULL, updated_at = ?3
      WHERE id = ?1 AND owner = ?2
      RETURNING *
    `);

    this.getStmt = db.prepare("SELECT * FROM tasks WHERE id = ?1");
  }

  async attemptClaim(taskId: string, agentId: string): Promise<Task | null> {
    const row = this.claimStmt.get(taskId, agentId, now()) as
      | TaskRow
      | undefined;
    return row ? mapRow(row) : null;
  }

  async releaseClaim(taskId: string, agentId: string): Promise<Task> {
    const row = this.releaseStmt.get(taskId, agentId, now()) as
      | TaskRow
      | undefined;
    if (!row) {
      const existing = this.getStmt.get(taskId) as TaskRow | undefined;
      if (!existing) {
        throw new TaskStoreError("Task not found", { taskId });
      }
      throw new TaskStoreError("Cannot release claim: not the owner", {
        taskId,
        agentId,
        currentOwner: existing.owner,
      });
    }
    return mapRow(row);
  }
}
