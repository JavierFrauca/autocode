import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Rutas de Nucleus. La BBDD vive en `C:\ProgramData\AutoCode` (por máquina, fuera del userData del
 * usuario), tal y como pidió el diseño: un solo índice RAG compartido para todos los proyectos.
 */
export function nucleusDataDir(): string {
  const base = process.platform === "win32"
    ? (process.env.ProgramData || "C:\\ProgramData")
    : (process.env.XDG_DATA_HOME || path.join(process.env.HOME || ".", ".local", "share"));
  const dir = path.join(base, "AutoCode");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Fichero único redb (ACID) del motor. */
export function nucleusDbPath(): string {
  return process.env.AUTOCODE_NUCLEUS_DB || path.join(nucleusDataDir(), "nucleus.redb");
}

/** Caché del modelo de embeddings (se descarga ~450 MB la primera vez que se ingesta/busca). */
export function nucleusModelCache(): string {
  const d = path.join(nucleusDataDir(), "models");
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Localiza `nucleus.dll`. En desarrollo está en `vendor/nucleus/`; empaquetada, en `resources/`
 * (electron-builder la copia vía extraResources). Se puede forzar con `AUTOCODE_NUCLEUS_DLL`.
 */
export function nucleusDllPath(): string {
  const candidates = [
    process.env.AUTOCODE_NUCLEUS_DLL,
    process.resourcesPath ? path.join(process.resourcesPath, "vendor", "nucleus", "nucleus.dll") : undefined,
    // out/main/<worker>.js → ../../vendor en el repo (dev)
    path.resolve(__dirname, "..", "..", "vendor", "nucleus", "nucleus.dll"),
    path.resolve(process.cwd(), "vendor", "nucleus", "nucleus.dll"),
  ].filter((c): c is string => !!c);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`nucleus.dll no encontrada. Busqué en:\n${candidates.join("\n")}`);
}
