import type { Database, Statement } from "bun:sqlite";
import type { ApprovalStatus } from "@sockt/types";

export interface StoredApproval {
  id: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  tier: string;
  action: string;
  description: string;
  context?: Record<string, unknown>;
  status: ApprovalStatus;
  decidedBy?: string;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
  timeoutAt?: string;
}

interface ApprovalRow {
  id: string;
  tenant_id: string;
  task_id: string;
  agent_id: string;
  tier: string | null;
  action: string | null;
  description: string | null;
  context: string | null;
  status: string;
  decided_by: string | null;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  timeout_at: string | null;
}

function mapRow(row: ApprovalRow): StoredApproval {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    tier: row.tier ?? "",
    action: row.action ?? "",
    description: row.description ?? "",
    context: row.context ? JSON.parse(row.context) : undefined,
    status: row.status as ApprovalStatus,
    decidedBy: row.decided_by ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    timeoutAt: row.timeout_at ?? undefined,
  };
}

/**
 * Sqlite-backed store for pending human approvals, using the shared
 * pending_human_inputs table (kind='approval' — see schema.ts for why this
 * is shared with clarifying questions). Was an in-memory Map with a
 * process-local counter for IDs — lost on every orch restart. A pending
 * approval now survives a restart; the requesting runtime worker's
 * HttpHitlGate is polling this via HTTP anyway, so it doesn't care that the
 * orch process serving those polls might not be the one that received the
 * original request.
 */
export class ApprovalStore {
  private readonly insertStmt: Statement;
  private readonly getStmt: Statement;
  private readonly listPendingStmt: Statement;
  private readonly decideStmt: Statement;
  private readonly sweepTimeoutsStmt: Statement;

  constructor(private readonly db: Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO pending_human_inputs
        (id, kind, tenant_id, task_id, agent_id, tier, action, description, context, status, created_at, timeout_at)
      VALUES (?1, 'approval', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10)
    `);
    this.getStmt = db.prepare("SELECT * FROM pending_human_inputs WHERE id = ?1 AND kind = 'approval'");
    this.listPendingStmt = db.prepare(
      "SELECT * FROM pending_human_inputs WHERE kind = 'approval' AND status = 'pending' AND tenant_id = ?1",
    );
    this.decideStmt = db.prepare(`
      UPDATE pending_human_inputs SET status = ?2, decided_by = ?3, reason = ?4, decided_at = ?5
      WHERE id = ?1 AND kind = 'approval' AND status = 'pending'
      RETURNING *
    `);
    this.sweepTimeoutsStmt = db.prepare(`
      UPDATE pending_human_inputs SET status = 'timeout', decided_by = 'system:timeout', decided_at = ?1
      WHERE kind = 'approval' AND status = 'pending' AND timeout_at IS NOT NULL AND timeout_at <= ?1
      RETURNING *
    `);
  }

  create(request: {
    tenantId: string;
    agentId: string;
    taskId: string;
    tier: string;
    action: string;
    description: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
  }): StoredApproval {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const timeoutAt = request.timeoutMs ? new Date(Date.now() + request.timeoutMs).toISOString() : null;
    this.insertStmt.run(
      id,
      request.tenantId,
      request.taskId,
      request.agentId,
      request.tier,
      request.action,
      request.description,
      request.context ? JSON.stringify(request.context) : null,
      createdAt,
      timeoutAt,
    );
    return {
      id,
      tenantId: request.tenantId,
      agentId: request.agentId,
      taskId: request.taskId,
      tier: request.tier,
      action: request.action,
      description: request.description,
      context: request.context,
      status: "pending",
      createdAt,
      timeoutAt: timeoutAt ?? undefined,
    };
  }

  get(id: string): StoredApproval | undefined {
    const row = this.getStmt.get(id) as ApprovalRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listPending(tenantId: string): StoredApproval[] {
    const rows = this.listPendingStmt.all(tenantId) as ApprovalRow[];
    return rows.map(mapRow);
  }

  decide(id: string, decision: { status: ApprovalStatus; decidedBy?: string; reason?: string }): StoredApproval | undefined {
    const row = this.decideStmt.get(
      id,
      decision.status,
      decision.decidedBy ?? null,
      decision.reason ?? null,
      new Date().toISOString(),
    ) as ApprovalRow | undefined;
    // No row back means it was already decided (or doesn't exist) — re-fetch
    // so callers get the current state either way instead of undefined.
    return row ? mapRow(row) : this.get(id);
  }

  /** Marks any pending approval past its timeout_at as timed out. Call
   * periodically (see the setInterval in serve.ts) — belt-and-braces with
   * HttpHitlGate's own client-side poll deadline, since the client could be
   * dead or the network partitioned when its deadline passes. */
  sweepTimeouts(): StoredApproval[] {
    const rows = this.sweepTimeoutsStmt.all(new Date().toISOString()) as ApprovalRow[];
    return rows.map(mapRow);
  }
}
