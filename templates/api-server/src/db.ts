import Database from "better-sqlite3";

/**
 * Persistencia con SQLite embebido (better-sqlite3). Un servicio API/integración no tiene interfaz: lo
 * consumen OTROS sistemas. Para probar/usar en local no hace falta Docker ni Postgres (la BD es un
 * fichero). En producción, cambia el driver a Postgres (mismo modelo de datos). El fichero se toma de
 * DB_FILE (lo fija AutoCode al "Probar") o "data.sqlite".
 */
let db: Database.Database | null = null;

export function initDb(file: string): void {
  db = new Database(file);
  db.pragma("journal_mode = WAL");

  // ── API keys — el servicio se autentica con claves, no con login de usuario ────────────────────
  db.exec(
    `CREATE TABLE IF NOT EXISTS api_keys (
       id         TEXT PRIMARY KEY,
       nombre     TEXT NOT NULL,
       key_hash   TEXT NOT NULL UNIQUE,
       activo     INTEGER NOT NULL DEFAULT 1,
       creado     TEXT NOT NULL,
       ultimo_uso TEXT
     )`,
  );

  // ── Registro de accesos / auditoría — OBLIGATORIO en un servicio expuesto ──────────────────────
  db.exec(
    `CREATE TABLE IF NOT EXISTS audit_log (
       id         TEXT PRIMARY KEY,
       actor_id   TEXT,
       accion     TEXT NOT NULL,
       recurso    TEXT NOT NULL,
       recurso_id TEXT,
       resultado  TEXT NOT NULL,
       ip         TEXT,
       user_agent TEXT,
       metadata   TEXT,
       creado     TEXT NOT NULL
     )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_creado ON audit_log (creado DESC)");

  // ── Datos de ejemplo (el agente reemplaza 'items' por el dominio real) ─────────────────────────
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
