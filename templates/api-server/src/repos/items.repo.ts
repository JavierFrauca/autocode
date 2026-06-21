import { getDb } from "../db.js";

/**
 * EJEMPLO del patrón Repository: el acceso a datos va SIEMPRE detrás de una interfaz (puerto). La lógica
 * depende de `ItemsRepo`, NO de SQLite → cambiar de motor (Postgres…) = otra implementación, sin tocar
 * los endpoints. El agente COPIA este patrón por cada entidad del dominio (`<entidad>.repo.ts`).
 */
export interface Item { id: number; nombre: string; creado: string }

export interface ItemsRepo {
  listar(): Item[];
  crear(nombre: string): Item;
}

export class ItemsRepoSqlite implements ItemsRepo {
  listar(): Item[] {
    return getDb().prepare("SELECT id, nombre, creado FROM items ORDER BY id DESC").all() as Item[];
  }
  crear(nombre: string): Item {
    const creado = new Date().toISOString();
    const info = getDb().prepare("INSERT INTO items (nombre, creado) VALUES (?, ?)").run(nombre, creado);
    return { id: Number(info.lastInsertRowid), nombre, creado };
  }
}
