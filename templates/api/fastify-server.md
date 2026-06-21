# Template: Fastify server entry point

**tags:** fastify, node, typescript, api
**transversal:** true

```typescript
// src/server.ts
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: process.env.NODE_ENV !== "production" });

await app.register(cors, { origin: process.env.CORS_ORIGIN ?? true });

// ── Rutas ────────────────────────────────────────────
import { registerRoutes } from "./routes/index.js";
await registerRoutes(app);

// ── Health check ─────────────────────────────────────
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// ── Start ────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Servidor en puerto ${port}`);
```
