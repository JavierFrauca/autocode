import { getDb } from "../db.js";

/**
 * EJEMPLO del patrón Repository (solo tiene sentido si activaste `initDb()` en db.ts): el acceso a
 * datos va SIEMPRE detrás de una interfaz (puerto), nunca con SQL suelto dentro de una tool. El agente
 * copia este patrón por cada "cosa" que el servidor necesite recordar.
 */
export interface Item {
  id: number;
  nombre: string;
  creado: string;
}

export interface ItemsRepo {
  listar(): Item[];
  crear(nombre: string): Item;
  borrar(id: number): void;
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
  borrar(id: number): void {
    getDb().prepare("DELETE FROM items WHERE id = ?").run(id);
  }
}
