import { type ItemsRepo, ItemsRepoSqlite } from "./items.repo.js";
import { type UsuariosRepo, UsuariosRepoSqlite } from "./usuarios.repo.js";
import { type AccesosRepo, AccesosRepoSqlite } from "./accesos.repo.js";

/**
 * COMPOSITION ROOT de la persistencia. Toda la app accede a la BD a través de estos repositorios (puertos),
 * nunca con SQL suelto. AQUÍ —y SOLO aquí— se elige el MOTOR de base de datos.
 *
 * Hoy: SQLite (cero instalación; local y "Probar"). Para cambiar a Postgres en producción:
 *   1) crea las implementaciones (p.ej. `usuarios.repo.postgres.ts` con `UsuariosRepoPostgres implements UsuariosRepo`),
 *   2) cámbialas aquí (o elige por entorno: `process.env.DB_DRIVER === "postgres" ? ... : ...`).
 * El resto de la app NO cambia: depende de las INTERFACES, no de la implementación.
 */
export interface Repos {
  items: ItemsRepo;
  usuarios: UsuariosRepo;
  accesos: AccesosRepo;
}

export const repos: Repos = {
  items: new ItemsRepoSqlite(),
  usuarios: new UsuariosRepoSqlite(),
  accesos: new AccesosRepoSqlite(),
};
