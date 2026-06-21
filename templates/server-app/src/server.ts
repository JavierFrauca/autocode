import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { initDb } from "./db.js";
import { seedAdmin } from "./auth/seed.js";
import { registrarGuard } from "./auth/guard.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerAdminRoutes } from "./auth/admin-routes.js";
import { registrarCabecerasSeguridad, registrarRateLimit } from "./security.js";
import { registerRoutes } from "./routes.js";

/**
 * Entrada del servidor. UN solo proceso que: sirve el frontend Vue YA construido (dist/public) como
 * estáticos, expone la API en /api/* y guarda en SQLite. Pensado para que AutoCode lo arranque y el
 * usuario abra http://localhost:PORT en su navegador para PROBAR la app, sin montar nada.
 *
 * SEGURIDAD (apps web): login OBLIGATORIO por construcción. Un guard global protege todo /api/* salvo
 * lo marcado público; los recursos del front (la SPA) se sirven sin auth para poder mostrar el login.
 * Se siembra un admin inicial (seed) para poder entrar la primera vez. Toda acción queda auditada.
 *
 * En producción: PORT, DB y AUTH_SECRET por variables de entorno; detrás de un proxy/TLS y, si hace
 * falta, Postgres.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

initDb(process.env.DB_FILE ?? "data.sqlite");
await seedAdmin();

const app = Fastify({ logger: false });

registrarCabecerasSeguridad(app); // cabeceras de seguridad en cada respuesta (helmet-lite)
registrarRateLimit(app);          // límite de peticiones por IP en /api/* (rate-limit-lite)
await app.register(fastifyCookie);
registrarGuard(app); // seguridad global ANTES de las rutas

await app.register(fastifyStatic, { root: join(__dirname, "public"), prefix: "/" });

app.get("/api/health", { config: { publico: true } }, async () => ({ ok: true, ts: new Date().toISOString() }));
await registerAuthRoutes(app);
await registerAdminRoutes(app);
await registerRoutes(app);

// SPA fallback: cualquier ruta que no sea /api ni un estático devuelve index.html (para el router del front).
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not found" });
  return reply.sendFile("index.html");
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`Servidor en http://localhost:${port}`);
