import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Logger estructurado mínimo. Objetivo: que cuando algo degrade en silencio quede
 * un rastro diagnosticable ("¿por qué no se guardó la versión? ¿por qué no hubo RAG?").
 *
 * - A consola SIEMPRE (la captura el proceso Electron / la terminal de dev).
 * - A fichero `<logs>/autocode.log` si se conoce el directorio (producción).
 * - SIN dependencia de `electron`: el dir se deriva de env, así los tests no se rompen.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

function logDir(): string | null {
  if (process.env.AUTOCODE_LOG_DIR) return process.env.AUTOCODE_LOG_DIR;
  if (process.env.AUTOCODE_DB_PATH) return path.join(path.dirname(process.env.AUTOCODE_DB_PATH), "logs");
  return null;
}

function serialize(v: unknown): unknown {
  if (v instanceof Error) {
    return { message: v.message, stack: v.stack?.split("\n").slice(0, 3).join(" | ") };
  }
  return v;
}

function metaToString(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(meta)) out[k] = serialize(val);
  try {
    return " " + JSON.stringify(out);
  } catch {
    return " [meta no serializable]";
  }
}

function emit(level: LogLevel, scope: string, msg: string, meta?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${msg}${metaToString(meta)}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);

  const dir = logDir();
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path.join(dir, "autocode.log"), line + "\n");
    } catch {
      /* el logging nunca debe tumbar la app */
    }
  }
}

export const log = {
  debug: (scope: string, msg: string, meta?: Record<string, unknown>) => emit("debug", scope, msg, meta),
  info: (scope: string, msg: string, meta?: Record<string, unknown>) => emit("info", scope, msg, meta),
  warn: (scope: string, msg: string, meta?: Record<string, unknown>) => emit("warn", scope, msg, meta),
  error: (scope: string, msg: string, meta?: Record<string, unknown>) => emit("error", scope, msg, meta),
};
