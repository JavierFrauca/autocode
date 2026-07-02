import { app } from "electron";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Persistencia con SQLite embebido (better-sqlite3): cero instalación, un fichero en el perfil del
 * usuario (`app.getPath("userData")`) — no en la carpeta de la app, que en Windows suele ser de solo
 * lectura para el usuario final. Misma idea que el andamiaje de servidor/API: acceso SIEMPRE a través de
 * un REPOSITORIO (`repos/`), nunca con SQL suelto desde el resto de src/main.
 */
let db: Database.Database | null = null;

export function initDb(): void {
  const file = path.join(app.getPath("userData"), "data.sqlite");
  db = new Database(file);
  db.pragma("journal_mode = WAL");

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
