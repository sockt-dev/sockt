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
  updated_at TEXT NOT NULL,
  target_department TEXT,
  target_role TEXT
);
`;

// Bun's sqlite CREATE TABLE IF NOT EXISTS means a column added after a
// database already exists on disk (e.g. an existing ~/.sockt/scratch/orch.sqlite
// from before this change) would otherwise never get it. Idempotent —
// PRAGMA table_info is cheap and this runs once at startup.
function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
`;

// Persists the Slack (or other channel) message that triggered a top-level
// task, so a reply can still be sent after an orch restart. Previously this
// correlation lived only in SlackReplyTelemetry's in-memory `pending` Map —
// documented as a known limitation ("if the orchestrator restarts mid-task,
// that task's reply is lost"), confirmed directly in the 2026-07-11 eval pass
// (mechanical probe M3). Also doubles as the thread_ts -> task_id lookup the
// clarifying-question flow needs to route a threaded reply back to the task
// it's answering, rather than treating it as a new unrelated message.
const CREATE_TASK_ORIGINS_TABLE = `
CREATE TABLE IF NOT EXISTS task_origins (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  tenant_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  created_at TEXT NOT NULL
);
`;

const CREATE_TASK_ORIGINS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_task_origins_thread ON task_origins(tenant_id, channel_id, thread_id);
`;

// Shared table for the two things a running task can pause and wait on a
// human for: an approval (a gated tool wants to run) or a clarifying question
// (the agent needs information it doesn't have). Same lifecycle — created by
// an agent, surfaced in Slack, resolved by a human event, consumed by the
// runtime — differing in response modality (button click vs. free-text
// thread reply) and in how the task resumes (approval: the runner is still
// alive, blocked in-process on the poll; question: the runner has exited and
// the task re-enters the queue on answer). One table, one Slack-correlation
// path, two `kind`s, rather than two parallel systems.
//
// Previously this was an in-memory `Map` in packages/orch/src/api/approval-store.ts
// with a process-local counter for IDs — lost on every orch restart, and
// nothing surfaced a pending approval to a human at all (HITL was defined but
// never wired up before 2026-07-12).
const CREATE_PENDING_HUMAN_INPUTS_TABLE = `
CREATE TABLE IF NOT EXISTS pending_human_inputs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('approval','question')),
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tier TEXT,
  action TEXT,
  description TEXT,
  question TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','timeout','answered','superseded')),
  decided_by TEXT,
  reason TEXT,
  answer TEXT,
  slack_channel_id TEXT,
  slack_thread_id TEXT,
  slack_message_ts TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  timeout_at TEXT
);
`;

const CREATE_PENDING_HUMAN_INPUTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_phi_tenant_status ON pending_human_inputs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_phi_task ON pending_human_inputs(task_id);
CREATE INDEX IF NOT EXISTS idx_phi_thread ON pending_human_inputs(tenant_id, slack_channel_id, slack_thread_id);
`;

export function initializeSchema(db: Database): void {
  db.exec(CREATE_TASKS_TABLE);
  db.exec(CREATE_INDEXES);
  db.exec(CREATE_TASK_ORIGINS_TABLE);
  db.exec(CREATE_TASK_ORIGINS_INDEX);
  db.exec(CREATE_PENDING_HUMAN_INPUTS_TABLE);
  db.exec(CREATE_PENDING_HUMAN_INPUTS_INDEXES);

  // Production-hardening additions (create_task targeting/ordering, HITL
  // reminder pings) — see docs/ARCHITECTURE.md's task-graph section.
  ensureColumn(db, "tasks", "target_skill", "TEXT");
  ensureColumn(db, "tasks", "after_id", "TEXT REFERENCES tasks(id)");
  ensureColumn(db, "pending_human_inputs", "reminded_at", "TEXT");
}
