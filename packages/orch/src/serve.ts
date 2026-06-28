import { Database } from "bun:sqlite";
import { initializeSchema } from "@sockt/fsm";
import { Orchestrator } from "./orchestrator.ts";

const port = Number(process.env.PORT ?? 3100);
const deploymentId = process.env.DEPLOYMENT_ID ?? "default";
const dbPath = process.env.DB_PATH ?? `${process.env.HOME}/.sockt/scratch/orch.sqlite`;

const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
await Bun.write(Bun.file(dir + "/.keep"), "");

const db = new Database(dbPath, { create: true });
initializeSchema(db);

const orch = new Orchestrator({
  port,
  dbPath,
  db,
  agents: [],
});

await orch.start();
console.log(`[orch] listening on port ${orch.getPort()}, tenant=${deploymentId}`);
