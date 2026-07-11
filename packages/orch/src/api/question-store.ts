import type { Database, Statement } from "bun:sqlite";

export interface StoredQuestion {
  id: string;
  tenantId: string;
  taskId: string;
  agentId: string;
  question: string;
  status: "pending" | "answered" | "superseded";
  answer?: string;
  slackChannelId?: string;
  slackThreadId?: string;
  createdAt: string;
  decidedAt?: string;
}

interface QuestionRow {
  id: string;
  tenant_id: string;
  task_id: string;
  agent_id: string;
  question: string | null;
  status: string;
  answer: string | null;
  slack_channel_id: string | null;
  slack_thread_id: string | null;
  created_at: string;
  decided_at: string | null;
}

function mapRow(row: QuestionRow): StoredQuestion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    question: row.question ?? "",
    status: row.status as StoredQuestion["status"],
    answer: row.answer ?? undefined,
    slackChannelId: row.slack_channel_id ?? undefined,
    slackThreadId: row.slack_thread_id ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

/**
 * Sqlite-backed store for clarifying questions an agent asks mid-task (the
 * ask_user pseudo-tool — see packages/runtime/src/tools/built-in/ask_user.ts),
 * using the same shared pending_human_inputs table as ApprovalStore
 * (kind='question'). Stores the originating Slack channel/thread at creation
 * time so a threaded reply can be matched back to the pending question via
 * findPendingByThread, without needing a second lookup against task_origins.
 */
export class QuestionStore {
  private readonly insertStmt: Statement;
  private readonly getStmt: Statement;
  private readonly findPendingByThreadStmt: Statement;
  private readonly answerStmt: Statement;

  constructor(private readonly db: Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO pending_human_inputs
        (id, kind, tenant_id, task_id, agent_id, question, status, slack_channel_id, slack_thread_id, created_at)
      VALUES (?1, 'question', ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)
    `);
    this.getStmt = db.prepare("SELECT * FROM pending_human_inputs WHERE id = ?1 AND kind = 'question'");
    this.findPendingByThreadStmt = db.prepare(`
      SELECT * FROM pending_human_inputs
      WHERE kind = 'question' AND status = 'pending'
        AND tenant_id = ?1 AND slack_channel_id = ?2 AND slack_thread_id = ?3
      ORDER BY created_at DESC LIMIT 1
    `);
    this.answerStmt = db.prepare(`
      UPDATE pending_human_inputs SET status = 'answered', answer = ?2, decided_at = ?3
      WHERE id = ?1 AND kind = 'question' AND status = 'pending'
      RETURNING *
    `);
  }

  create(request: {
    tenantId: string;
    taskId: string;
    agentId: string;
    question: string;
    slackChannelId?: string;
    slackThreadId?: string;
  }): StoredQuestion {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.insertStmt.run(
      id,
      request.tenantId,
      request.taskId,
      request.agentId,
      request.question,
      request.slackChannelId ?? null,
      request.slackThreadId ?? null,
      createdAt,
    );
    return {
      id,
      tenantId: request.tenantId,
      taskId: request.taskId,
      agentId: request.agentId,
      question: request.question,
      status: "pending",
      slackChannelId: request.slackChannelId,
      slackThreadId: request.slackThreadId,
      createdAt,
    };
  }

  get(id: string): StoredQuestion | undefined {
    const row = this.getStmt.get(id) as QuestionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /** Used by the thread-reply interception in Orchestrator.handleMessage to
   * tell "this message is answering a pending question" apart from "this is
   * a new request" — matched by the Slack channel+thread the question was
   * originally posted to. */
  findPendingByThread(tenantId: string, channelId: string, threadId: string): StoredQuestion | undefined {
    const row = this.findPendingByThreadStmt.get(tenantId, channelId, threadId) as QuestionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  answer(id: string, answer: string): StoredQuestion | undefined {
    const row = this.answerStmt.get(id, answer, new Date().toISOString()) as QuestionRow | undefined;
    return row ? mapRow(row) : this.get(id);
  }
}
