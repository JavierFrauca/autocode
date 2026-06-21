import { type ItemsRepo, ItemsRepoSqlite } from "./items.repo.js";
import { type ApiKeysRepo, ApiKeysRepoSqlite } from "./api-keys.repo.js";
import { type AccesosRepo, AccesosRepoSqlite } from "./accesos.repo.js";

/**
 * COMPOSITION ROOT de la persistencia. Toda la app accede a la BD a través de estos repositorios (puertos),
 * nunca con SQL suelto. AQUÍ —y SOLO aquí— se elige el MOTOR de base de datos.
 *
 * Hoy: SQLite. Para Postgres en producción: implementa los repos contra el nuevo motor (p.ej.
 * `items.repo.postgres.ts`) y cámbialos aquí (o por `process.env.DB_DRIVER`). El resto NO cambia: depende
 * de las INTERFACES.
 */
export interface Repos {
  items: ItemsRepo;
  apiKeys: ApiKeysRepo;
  accesos: AccesosRepo;
}

export const repos: Repos = {
  items: new ItemsRepoSqlite(),
  apiKeys: new ApiKeysRepoSqlite(),
  accesos: new AccesosRepoSqlite(),
};
