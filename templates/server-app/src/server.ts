import { buildApp } from "./app.js";

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
 * falta, Postgres. La construcción de la app (sin arrancarla) vive en `app.ts`, para poder testear
 * rutas con `app.inject()` sin pasar por aquí — ver `tests/`.
 */
const port = Number(process.env.PORT ?? 3000);

const app = await buildApp(process.env.DB_FILE ?? "data.sqlite");

await app.listen({ port, host: "0.0.0.0" });
console.log(`Servidor en http://localhost:${port}`);
