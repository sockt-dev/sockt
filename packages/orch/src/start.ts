import { Database } from "bun:sqlite";
import { initializeSchema } from "@sockt/fsm";
import { Orchestrator } from "./orchestrator.ts";

const PORT    = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH ?? "./sockt.db";

const db = new Database(DB_PATH);
initializeSchema(db);

const orch = new Orchestrator({ port: PORT, dbPath: DB_PATH, db, agents: [] });

await orch.start();

console.log(`\n  Sockt Orchestrator  →  http://localhost:${orch.getPort()}\n`);

process.on("SIGINT",  async () => { await orch.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await orch.stop(); process.exit(0); });
