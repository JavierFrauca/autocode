import type Database from "better-sqlite3";
import { getDb } from "../db.js";

/**
 * Base de Repository sobre better-sqlite3: cubre el CRUD que se repite en TODA entidad del dominio
 * (listar/buscarPorId/existe/borrar). Cada entidad EXTIENDE esta clase y solo añade lo que de verdad
 * es específico suyo (crear/actualizar con sus propias columnas, búsquedas de negocio, joins). La
 * PRIMERA entidad que se cree fija el patrón; las siguientes se apoyan en la MISMA base, no reinventan
 * el CRUD genérico cada vez. Cambiar de motor (Postgres) es escribir una implementación alternativa de
 * esta misma base, no reescribir cada repo por separado — ver `library/arquitectura/repository.md`.
 */
export abstract class BaseRepoSqlite<T> {
  /** Nombre real de la tabla en SQLite. */
  protected abstract readonly tabla: string;
  /** Columna que actúa como identificador (normalmente "id"). */
  protected abstract readonly idColumna: string;

  protected db(): Database.Database {
    return getDb();
  }

  listar(ordenSql = `${this.idColumna} DESC`): T[] {
    return this.db().prepare(`SELECT * FROM ${this.tabla} ORDER BY ${ordenSql}`).all() as T[];
  }

  buscarPorId(id: string | number): T | undefined {
    return this.db().prepare(`SELECT * FROM ${this.tabla} WHERE ${this.idColumna} = ?`).get(id) as T | undefined;
  }

  existe(id: string | number): boolean {
    return !!this.db().prepare(`SELECT 1 FROM ${this.tabla} WHERE ${this.idColumna} = ?`).get(id);
  }

  borrar(id: string | number): void {
    this.db().prepare(`DELETE FROM ${this.tabla} WHERE ${this.idColumna} = ?`).run(id);
  }
}
