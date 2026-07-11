import type { Database, Statement } from "bun:sqlite";

export interface TaskOrigin {
  taskId: string;
  tenantId: string;
  platform: string;
  channelId: string;
  threadId: string | null;
  createdAt: string;
}

interface TaskOriginRow {
  task_id: string;
  tenant_id: string;
  platform: string;
  channel_id: string;
  thread_id: string | null;
  created_at: string;
}

function mapRow(row: TaskOriginRow): TaskOrigin {
  return {
    taskId: row.task_id,
    tenantId: row.tenant_id,
    platform: row.platform,
    channelId: row.channel_id,
    threadId: row.thread_id,
    createdAt: row.created_at,
  };
}

/**
 * Persists which channel message triggered a top-level task, so a reply can
 * still be routed after an orch restart (previously this correlation only
 * lived in SlackReplyTelemetry's in-memory Map) and so a threaded reply can
 * be matched back to the task it's answering (used by the clarifying-question
 * flow to distinguish "this is an answer" from "this is a new request").
 */
export class TaskOriginStore {
  private readonly insertStmt: Statement;
  private readonly getStmt: Statement;
  private readonly findByThreadStmt: Statement;

  constructor(private readonly db: Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO task_origins (task_id, tenant_id, platform, channel_id, thread_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(task_id) DO NOTHING
    `);
    this.getStmt = db.prepare("SELECT * FROM task_origins WHERE task_id = ?1");
    this.findByThreadStmt = db.prepare(
      "SELECT * FROM task_origins WHERE tenant_id = ?1 AND channel_id = ?2 AND thread_id = ?3",
    );
  }

  create(origin: Omit<TaskOrigin, "createdAt">): TaskOrigin {
    const createdAt = new Date().toISOString();
    this.insertStmt.run(origin.taskId, origin.tenantId, origin.platform, origin.channelId, origin.threadId, createdAt);
    return { ...origin, createdAt };
  }

  get(taskId: string): TaskOrigin | null {
    const row = this.getStmt.get(taskId) as TaskOriginRow | undefined;
    return row ? mapRow(row) : null;
  }

  findByThread(tenantId: string, channelId: string, threadId: string): TaskOrigin | null {
    const row = this.findByThreadStmt.get(tenantId, channelId, threadId) as TaskOriginRow | undefined;
    return row ? mapRow(row) : null;
  }
}
