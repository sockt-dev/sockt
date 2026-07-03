import index from "./index.html"

const PORT = Number(process.env.PORT) || 3001

Bun.serve({
  port: PORT,
  routes: {
    "/": index,
    "/api/config": {
      GET: () =>
        Response.json({
          orchUrl: process.env.ORCH_URL ?? "http://localhost:3000",
          tenantId: process.env.TENANT_ID ?? "default",
        }),
    },
  },
  development: process.env.NODE_ENV !== "production"
    ? { hmr: true, console: true }
    : undefined,
})

console.log(`\n  Sockt UI  →  http://localhost:${PORT}\n`)
