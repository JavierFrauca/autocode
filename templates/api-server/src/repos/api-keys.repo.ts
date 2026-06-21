import { getDb } from "../db.js";

/** Persistencia de las API keys detrás de una interfaz. El guard y la siembra dependen de ESTO, no de SQLite.
 *  Se guarda solo el HASH de la clave (nunca la clave en claro); el hash lo calcula la capa de auth. */
export interface ApiKeysRepo {
  buscarPorHash(keyHash: string): { id: string; activo: boolean } | undefined;
  marcarUso(id: string, cuando: string): void;
  buscarPorNombre(nombre: string): { id: string } | undefined;
  crear(k: { id: string; nombre: string; keyHash: string }): void;
  establecerHash(id: string, keyHash: string): void;
}

export class ApiKeysRepoSqlite implements ApiKeysRepo {
  buscarPorHash(keyHash: string): { id: string; activo: boolean } | undefined {
    const r = getDb().prepare("SELECT id, activo FROM api_keys WHERE key_hash = ?").get(keyHash) as
      | { id: string; activo: number }
      | undefined;
    return r ? { id: r.id, activo: !!r.activo } : undefined;
  }
  marcarUso(id: string, cuando: string): void {
    getDb().prepare("UPDATE api_keys SET ultimo_uso = ? WHERE id = ?").run(cuando, id);
  }
  buscarPorNombre(nombre: string): { id: string } | undefined {
    return getDb().prepare("SELECT id FROM api_keys WHERE nombre = ?").get(nombre) as { id: string } | undefined;
  }
  crear(k: { id: string; nombre: string; keyHash: string }): void {
    getDb()
      .prepare("INSERT INTO api_keys (id, nombre, key_hash, activo, creado) VALUES (?, ?, ?, 1, ?)")
      .run(k.id, k.nombre, k.keyHash, new Date().toISOString());
  }
  establecerHash(id: string, keyHash: string): void {
    getDb().prepare("UPDATE api_keys SET key_hash = ?, activo = 1 WHERE id = ?").run(keyHash, id);
  }
}
