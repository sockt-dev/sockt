import { GBrainMcpClient } from "@sockt/memory";
import { CadvpDaemon } from "./daemon.ts";

const gbrainUrl = process.env.GBRAIN_URL ?? "http://localhost:3200";
const watchDir = process.env.WATCH_DIR ?? `${process.env.HOME}/.sockt/scratch`;
const checkpointPath = process.env.CHECKPOINT_PATH ?? `${process.env.HOME}/.sockt/scratch/cadvp-checkpoint.json`;

const store = new GBrainMcpClient({ endpoint: gbrainUrl });

const daemon = new CadvpDaemon({
  store,
  checkpointPath,
});

await daemon.start([watchDir]);
console.log(`[cadvp] watching ${watchDir}`);
