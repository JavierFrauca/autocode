import { buildApp } from "./app.js";
import { startJobs } from "./jobs.js";

/**
 * Entrada del SERVICIO API / integración. UN proceso que expone la API en `/api/*` (autenticada por API
 * key), guarda en SQLite y ejecuta tareas programadas. NO tiene interfaz de usuario: lo consumen otros
 * sistemas. Sirve una pequeña PÁGINA DE ESTADO en `/` (pública) para que, al "Probar", se vea que el
 * servicio está vivo y qué expone.
 *
 * En producción: PORT, DB y API_KEY por variables de entorno; detrás de un proxy/TLS y, si hace falta,
 * Postgres en vez de SQLite. La construcción de la app (sin arrancarla) vive en `app.ts`, para poder
 * testear rutas con `app.inject()` sin pasar por aquí — ver `tests/`.
 */
const port = Number(process.env.PORT ?? 3000);

const app = await buildApp(process.env.DB_FILE ?? "data.sqlite");
startJobs();

await app.listen({ port, host: "0.0.0.0" });
console.log(`Servicio API en http://localhost:${port}`);
