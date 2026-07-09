import { BaseRepoSqlite } from "./base.repo.js";

/**
 * EJEMPLO del patrón Repository: el acceso a datos va SIEMPRE detrás de una interfaz (puerto), y el
 * CRUD genérico (listar/buscarPorId/borrar) se hereda de `BaseRepoSqlite` — NO se reescribe a mano por
 * entidad. La lógica de la app depende de `ItemsRepo`, NO de SQLite → cambiar de motor (Postgres…) es
 * otra implementación de la MISMA base, sin tocar rutas/servicios. El agente COPIA este patrón por cada
 * entidad del dominio (un fichero `<entidad>.repo.ts`: interfaz + clase que EXTIENDE `BaseRepoSqlite`,
 * registrado en `repos/index.ts`). La primera entidad fija el patrón; las siguientes lo reutilizan tal
 * cual, no inventan una forma distinta.
 */
export interface Item {
  id: number;
  nombre: string;
  creado: string;
}

/** Puerto (lo que la app necesita de la persistencia de items). */
export interface ItemsRepo {
  listar(): Item[];
  crear(nombre: string): Item;
  borrar(id: number): void;
}

/** Implementación SQLite. Para Postgres se crearía `ItemsRepoPostgres extends BaseRepoSqlite<Item>` con su propio driver. */
export class ItemsRepoSqlite extends BaseRepoSqlite<Item> implements ItemsRepo {
  protected readonly tabla = "items";
  protected readonly idColumna = "id";

  crear(nombre: string): Item {
    const creado = new Date().toISOString();
    const info = this.db().prepare("INSERT INTO items (nombre, creado) VALUES (?, ?)").run(nombre, creado);
    return { id: Number(info.lastInsertRowid), nombre, creado };
  }
}
