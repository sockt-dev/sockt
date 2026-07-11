import type { Database, Statement } from "bun:sqlite";
import type { Task, TaskCreate, TaskPatch, TaskStatus, TaskStore } from "@sockt/types";
import { TaskStoreError, TASK_STATUS_VALUES } from "@sockt/types";
import { generateId } from "../util/id.ts";
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
  target_department: string | null;
  target_role: string | null;
}

const PATCH_COLUMN_MAP: Record<keyof TaskPatch, string> = {
  status: "status",
  owner: "owner",
  output: "output",
  description: "description",
  llmCallsUsed: "llm_calls_used",
  attemptCount: "attempt_count",
};

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status as TaskStatus,
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
    targetDepartment: row.target_department,
    targetRole: row.target_role,
  };
}

export class SqliteTaskStore implements TaskStore {
  private readonly db: Database;
  private readonly insertStmt: Statement;
  private readonly getStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly listPendingStmt: Statement;
  private readonly listByParentStmt: Statement;
  private readonly listByOwnerStmt: Statement;
  private readonly countByStatusStmt: Statement;
  private readonly incrementLlmStmt: Statement;
  private readonly claimStmt: Statement;
  private readonly listAllByTenantStmt: Statement;
  private readonly listByStatusAndTenantStmt: Statement;

  constructor(db: Database) {
    this.db = db;
    db.exec("PRAGMA journal_mode=WAL");

    this.insertStmt = db.prepare(`
      INSERT INTO tasks (id, tenant_id, status, owner, parent_id, description, output, llm_calls_used, llm_calls_budget, attempt_count, max_attempts, created_at, updated_at, target_department, target_role)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    `);

    this.getStmt = db.prepare("SELECT * FROM tasks WHERE id = ?1");

    this.deleteStmt = db.prepare("DELETE FROM tasks WHERE id = ?1");

    this.listPendingStmt = db.prepare(
      "SELECT * FROM tasks WHERE tenant_id = ?1 AND status = 'pending'"
    );

    this.listByParentStmt = db.prepare(
      "SELECT * FROM tasks WHERE parent_id = ?1"
    );

    this.listByOwnerStmt = db.prepare("SELECT * FROM tasks WHERE owner = ?1");

    this.countByStatusStmt = db.prepare(
      "SELECT status, COUNT(*) as count FROM tasks WHERE tenant_id = ?1 GROUP BY status"
    );

    this.incrementLlmStmt = db.prepare(`
      UPDATE tasks SET llm_calls_used = llm_calls_used + 1, updated_at = ?2
      WHERE id = ?1
      RETURNING llm_calls_used, llm_calls_budget
    `);

    this.claimStmt = db.prepare(`
      UPDATE tasks SET status = 'in_progress', owner = ?2, updated_at = ?3
      WHERE id = ?1 AND status = 'pending' AND owner IS NULL
      RETURNING *
    `);

    this.listAllByTenantStmt = db.prepare(
      "SELECT * FROM tasks WHERE tenant_id = ?1 ORDER BY updated_at DESC"
    );

    this.listByStatusAndTenantStmt = db.prepare(
      "SELECT * FROM tasks WHERE tenant_id = ?1 AND status = ?2 ORDER BY updated_at DESC"
    );
  }

  async create(task: TaskCreate): Promise<Task> {
    const id = generateId();
    const timestamp = now();
    const status = "pending";
    const llmCallsBudget = task.llmCallsBudget ?? 25;
    const maxAttempts = task.maxAttempts ?? 3;

    this.insertStmt.run(
      id,
      task.tenantId,
      status,
      null,
      task.parentId ?? null,
      task.description,
      null,
      0,
      llmCallsBudget,
      0,
      maxAttempts,
      timestamp,
      timestamp,
      task.targetDepartment ?? null,
      task.targetRole ?? null
    );

    return {
      id,
      tenantId: task.tenantId,
      status,
      owner: null,
      parentId: task.parentId ?? null,
      description: task.description,
      output: null,
      llmCallsUsed: 0,
      llmCallsBudget: llmCallsBudget,
      attemptCount: 0,
      maxAttempts,
      createdAt: timestamp,
      updatedAt: timestamp,
      targetDepartment: task.targetDepartment ?? null,
      targetRole: task.targetRole ?? null,
    };
  }

  async get(id: string): Promise<Task | null> {
    const row = this.getStmt.get(id) as TaskRow | undefined;
    return row ? mapRow(row) : null;
  }

  async claim(taskId: string, owner: string): Promise<Task> {
    const row = this.claimStmt.get(taskId, owner, now()) as
      | TaskRow
      | undefined;
    if (!row) {
      throw new TaskStoreError("Failed to claim task", { taskId, owner });
    }
    return mapRow(row);
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const entries = Object.entries(patch).filter(
      ([, v]) => v !== undefined
    ) as [keyof TaskPatch, unknown][];

    if (entries.length > 0) {
      const timestamp = now();
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];
      let paramIdx = 1;

      for (const [key, value] of entries) {
        const col = PATCH_COLUMN_MAP[key];
        setClauses.push(`${col} = ?${paramIdx}`);
        values.push(value as string | number | null);
        paramIdx++;
      }

      setClauses.push(`updated_at = ?${paramIdx}`);
      values.push(timestamp);
      paramIdx++;

      values.push(id);
      const sql = `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?${paramIdx}`;
      this.db.prepare(sql).run(...values);
    }

    const task = await this.get(id);
    if (!task) {
      throw new TaskStoreError("Task not found", { id });
    }
    return task;
  }

  async listPending(tenantId: string): Promise<Task[]> {
    const rows = this.listPendingStmt.all(tenantId) as TaskRow[];
    return rows.map(mapRow);
  }

  async listByParent(parentId: string): Promise<Task[]> {
    const rows = this.listByParentStmt.all(parentId) as TaskRow[];
    return rows.map(mapRow);
  }

  async incrementLlmCalls(taskId: string): Promise<{ remaining: number }> {
    const row = this.incrementLlmStmt.get(taskId, now()) as
      | { llm_calls_used: number; llm_calls_budget: number }
      | undefined;
    if (!row) {
      throw new TaskStoreError("Task not found", { taskId });
    }
    return { remaining: row.llm_calls_budget - row.llm_calls_used };
  }

  async delete(id: string): Promise<void> {
    const task = await this.get(id);
    if (!task) {
      throw new TaskStoreError("Task not found", { id });
    }
    this.deleteStmt.run(id);
  }

  async listAll(tenantId: string, status?: TaskStatus): Promise<Task[]> {
    if (status) {
      const rows = this.listByStatusAndTenantStmt.all(tenantId, status) as TaskRow[];
      return rows.map(mapRow);
    }
    const rows = this.listAllByTenantStmt.all(tenantId) as TaskRow[];
    return rows.map(mapRow);
  }

  async listByOwner(owner: string): Promise<Task[]> {
    const rows = this.listByOwnerStmt.all(owner) as TaskRow[];
    return rows.map(mapRow);
  }

  async countByStatus(
    tenantId: string
  ): Promise<Record<TaskStatus, number>> {
    const rows = this.countByStatusStmt.all(tenantId) as {
      status: string;
      count: number;
    }[];

    const result = {} as Record<TaskStatus, number>;
    for (const status of TASK_STATUS_VALUES) {
      result[status] = 0;
    }
    for (const row of rows) {
      result[row.status as TaskStatus] = row.count;
    }
    return result;
  }
}
