import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { initDb } from "./db.js";
import { seedAdmin } from "./auth/seed.js";
import { registrarGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerAdminRoutes } from "./auth/admin-routes.js";
import { registrarCabecerasSeguridad, registrarRateLimit } from "./security.js";
import { registerRoutes } from "./routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Construye la app Fastify SIN arrancarla (sin `.listen()`), separado de `server.ts` para poder
 * testear rutas con `app.inject()` (sin abrir un puerto real ni necesitar el frontend construido) —
 * ver `tests/`. `server.ts` es el único que la arranca de verdad.
 *
 * `publicDir` por defecto es `dist/public` (el frontend Vue ya construido); los tests pasan un
 * directorio propio con un `index.html` mínimo, porque en test no se ha corrido `vite build`.
 */
export async function buildApp(dbFile: string, publicDir = join(__dirname, "public")): Promise<FastifyInstance> {
  initDb(dbFile);
  await seedAdmin();

  const app = Fastify({ logger: false });

  registrarCabecerasSeguridad(app); // cabeceras de seguridad en cada respuesta (helmet-lite)
  registrarRateLimit(app);          // límite de peticiones por IP en /api/* (rate-limit-lite)
  await app.register(fastifyCookie);
  registrarGuard(app); // seguridad global ANTES de las rutas

  await app.register(fastifyStatic, { root: publicDir, prefix: "/" });

  app.get("/api/health", { config: { publico: true } }, async () => ({ ok: true, ts: new Date().toISOString() }));
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerRoutes(app);

  // SPA fallback: cualquier ruta que no sea /api ni un estático devuelve index.html (para el router del front).
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });

  return app;
}
