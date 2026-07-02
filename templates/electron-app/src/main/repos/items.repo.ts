import { getDb } from "../db.js";

/**
 * EJEMPLO del patrón Repository: el acceso a datos va SIEMPRE detrás de una interfaz (puerto). La lógica
 * de la app depende de `ItemsRepo`, NO de SQLite directamente. El agente COPIA este patrón por cada
 * entidad del dominio (un fichero `<entidad>.repo.ts` con su interfaz + impl, registrado en `repos/index.ts`).
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

/** Implementación SQLite. */
export class ItemsRepoSqlite implements ItemsRepo {
  listar(): Item[] {
    return getDb().prepare("SELECT id, nombre, creado FROM items ORDER BY id DESC").all() as Item[];
  }
  crear(nombre: string): Item {
    const creado = new Date().toISOString();
    const info = getDb().prepare("INSERT INTO items (nombre, creado) VALUES (?, ?)").run(nombre, creado);
    return { id: Number(info.lastInsertRowid), nombre, creado };
  }
  borrar(id: number): void {
    getDb().prepare("DELETE FROM items WHERE id = ?").run(id);
  }
}
