import { Database } from "bun:sqlite";
import { initializeSchema } from "../store/schema.ts";

export function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  initializeSchema(db);
  return db;
}
