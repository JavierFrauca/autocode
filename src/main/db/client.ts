import path from "node:path";
import { promises as fs } from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _sqlite: Database.Database | null = null;

function resolveDbPath(): string {
  return process.env.AUTOCODE_DB_PATH
    ? path.resolve(process.env.AUTOCODE_DB_PATH)
    : path.resolve(process.cwd(), "autocode.db");
}

export function rawSqlite(): Database.Database {
  if (_sqlite) return _sqlite;
  const dbPath = resolveDbPath();
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  return _sqlite;
}

export function db(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  _db = drizzle(rawSqlite(), { schema });
  return _db;
}

export async function pingDb(): Promise<boolean> {
  try {
    rawSqlite().prepare("select 1").get();
    return true;
  } catch {
    return false;
  }
}

export async function ensureDbDir(): Promise<void> {
  await fs.mkdir(path.dirname(resolveDbPath()), { recursive: true });
}

export { schema };
