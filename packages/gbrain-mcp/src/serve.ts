import { MemoryStore } from "./store.ts";
import { handleMcpRequest } from "./handler.ts";

const port = Number(process.env.PORT ?? 3200);
const gbrainDir = process.env.GBRAIN_DIR ?? "./gbrain";

const dbPath = `${gbrainDir}/memory.sqlite`;
const store = new MemoryStore(dbPath);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "healthy" });
    }

    if (req.method === "POST" && url.pathname === "/mcp") {
      const body = await req.json();
      const response = handleMcpRequest(store, body);
      return Response.json(response);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`[gbrain-mcp] listening on port ${port}, dir=${gbrainDir}`);
