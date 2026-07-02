import Database from "better-sqlite3";

/**
 * Persistencia OPCIONAL con SQLite embebido: la mayoría de servidores MCP son "proxies" sin estado
 * (llaman a una API, leen un fichero…) y no la necesitan — por eso NO se inicializa sola. Si tu dominio
 * SÍ necesita recordar algo entre llamadas (una cola, contadores, caché…), llama a `initDb()` una vez al
 * arrancar (en server.ts o en cada transporte) y accede SIEMPRE a través de un repositorio (`repos/`),
 * nunca con SQL suelto. Mismo patrón que usan los andamiajes de escritorio/servidor/API.
 */
let db: Database.Database | null = null;

export function initDb(file = "data.sqlite"): void {
  db = new Database(file);
  db.pragma("journal_mode = WAL");

  // ── Tabla de EJEMPLO (ver repos/items.repo.ts) — bórrala si no la usas ─────────────────────────
  db.exec(
    `CREATE TABLE IF NOT EXISTS items (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nombre TEXT NOT NULL,
       creado TEXT NOT NULL
     )`,
  );
}

export function getDb(): Database.Database {
  if (!db) throw new Error("La base de datos no está inicializada (llama a initDb primero).");
  return db;
}
