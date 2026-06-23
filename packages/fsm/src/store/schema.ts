import type { Database } from "bun:sqlite";

const CREATE_TASKS_TABLE = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','escalated','blocked','cancelled')),
  owner TEXT,
  parent_id TEXT REFERENCES tasks(id),
  description TEXT NOT NULL,
  output TEXT,
  llm_calls_used INTEGER NOT NULL DEFAULT 0,
  llm_calls_budget INTEGER NOT NULL DEFAULT 25,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
`;

export function initializeSchema(db: Database): void {
  db.exec(CREATE_TASKS_TABLE);
  db.exec(CREATE_INDEXES);
}
