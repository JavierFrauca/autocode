import Database from "better-sqlite3";

/**
 * Persistencia con SQLite embebido (better-sqlite3): cero instalación, un fichero en el perfil del
 * usuario — no en la carpeta de la app, que en Windows suele ser de solo lectura para el usuario final.
 * Misma idea que el andamiaje de servidor/API: acceso SIEMPRE a través de un REPOSITORIO (`repos/`),
 * nunca con SQL suelto desde el resto de src/main.
 *
 * Recibe la ruta del fichero como parámetro (no llama a `app.getPath` aquí) para poder testear esta
 * capa con vitest, fuera de un proceso Electron real — `index.ts` es quien resuelve la ruta real con
 * `app.getPath("userData")` y quien pasa ":memory:" (o un fichero temporal) en los tests.
 */
let db: Database.Database | null = null;

export function initDb(file: string): void {
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
