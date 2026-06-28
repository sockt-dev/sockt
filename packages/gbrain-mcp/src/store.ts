import { Database } from "bun:sqlite";

export interface MemoryRow {
  id: string;
  tenant_id: string;
  category: string;
  content: string;
  source: string;
  metadata: string | null;
  created_at: string;
}

export class MemoryStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_tenant ON memories(tenant_id)
    `);
  }

  write(entry: {
    tenantId: string;
    content: string;
    category: string;
    source: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = entry.metadata ? JSON.stringify(entry.metadata) : null;

    this.db.run(
      `INSERT INTO memories (id, tenant_id, category, content, source, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, entry.tenantId, entry.category, entry.content, entry.source, metadata, createdAt],
    );

    return id;
  }

  search(query: {
    tenantId: string;
    query: string;
    categories?: string[];
    limit?: number;
    threshold?: number;
  }): MemoryRow[] {
    const limit = query.limit ?? 10;
    const pattern = `%${query.query}%`;

    let sql = `SELECT * FROM memories WHERE tenant_id = ? AND content LIKE ?`;
    const params: unknown[] = [query.tenantId, pattern];

    if (query.categories && query.categories.length > 0) {
      const placeholders = query.categories.map(() => "?").join(", ");
      sql += ` AND category IN (${placeholders})`;
      params.push(...query.categories);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return this.db.query(sql).all(...params) as MemoryRow[];
  }

  delete(entryId: string): boolean {
    const result = this.db.run(`DELETE FROM memories WHERE id = ?`, [entryId]);
    return result.changes > 0;
  }

  listCategories(tenantId: string): string[] {
    const rows = this.db
      .query(`SELECT DISTINCT category FROM memories WHERE tenant_id = ?`)
      .all(tenantId) as { category: string }[];
    return rows.map((r) => r.category);
  }

  commit(_tenantId: string, _message: string): void {
    // No-op for local tier — git sync is cloud-only
  }
}
