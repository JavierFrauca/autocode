import Fastify, { type FastifyInstance } from "fastify";
import { initDb } from "./db.js";
import { seedApiKey, registrarGuard } from "./auth.js";
import { registrarCabecerasSeguridad, registrarRateLimit, registrarCors } from "./security.js";
import { registerRoutes } from "./routes.js";

/**
 * Construye la app Fastify SIN arrancarla (sin `.listen()`), separado de `server.ts` para poder
 * testear rutas con `app.inject()` (sin abrir un puerto real) — ver `tests/`. `server.ts` es el único
 * que la arranca de verdad.
 */
export async function buildApp(dbFile: string): Promise<FastifyInstance> {
  initDb(dbFile);
  await seedApiKey();

  const app = Fastify({ logger: false });

  registrarCabecerasSeguridad(app); // helmet-lite
  registrarRateLimit(app);          // rate-limit-lite por IP en /api/*
  // CORS: orígenes de navegador permitidos (coma-separados en ALLOWED_ORIGINS). Vacío = sin CORS (server-a-server).
  registrarCors(app, (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  registrarGuard(app); // seguridad global (API key) ANTES de las rutas

  const STATUS_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Servicio API</title>
<style>:root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#f5f7fb;color:#0f172a;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #e7ecf3;border-radius:14px;padding:28px 32px;max-width:560px;
box-shadow:0 8px 24px rgba(16,24,40,.06)}h1{margin:0 0 6px;font-size:1.4rem;color:#4f46e5}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px}ul{line-height:1.9;padding-left:18px}</style></head>
<body><div class="card"><h1>✅ Servicio en marcha</h1>
<p>Este es un <strong>servicio de API</strong>: no tiene interfaz; lo consumen otros sistemas con una
<strong>API key</strong> en la cabecera <code>Authorization: Bearer &lt;clave&gt;</code>.</p>
<p>Endpoints de ejemplo:</p>
<ul><li><code>GET /api/health</code> — estado (público)</li>
<li><code>GET /api/items</code> — lista (requiere clave)</li>
<li><code>POST /api/items</code> — crea (requiere clave)</li>
<li><code>POST /api/webhooks/ejemplo</code> — receptor de webhook</li></ul></div></body></html>`;

  app.get("/", { config: { publico: true } }, async (_req, reply) => {
    reply.type("text/html").send(STATUS_HTML);
  });
  app.get("/api/health", { config: { publico: true } }, async () => ({ ok: true, ts: new Date().toISOString() }));

  await registerRoutes(app);
  return app;
}
