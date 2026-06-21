import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";

/**
 * Numeración de documentos con prefijo (ADR-NNN, RN-NNN, ...). El LLM no ve lo que ya hay en
 * disco, así que numeraba siempre desde 001 y producía duplicados (ADR-001 ×3, RN-004 ×4...).
 * Aquí calculamos de forma determinista el siguiente número libre a partir de los ficheros que
 * YA existen en la carpeta. El LLM sigue poniendo el "nombre" (el slug), pero el número es un ancla.
 * Una sola implementación que consumen el MCP, el chat y el documenter.
 */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Carpeta por defecto para los prefijos canónicos de AutoCode (si el llamante no pasa carpeta). */
const DEFAULT_FOLDER: Record<string, string> = { ADR: "decisiones", RN: "reglas", DT: "tecnicos" };

export interface NextNumberResult {
  /** Prefijo normalizado en mayúsculas, p.ej. "RN". */
  prefix: string;
  /** Carpeta normalizada (sin barras sobrantes), p.ej. "reglas". */
  folder: string;
  /** Siguiente número libre como entero, p.ej. 9. */
  next: number;
  /** Siguiente número con relleno de ceros según el ancho observado, p.ej. "009". */
  nextPadded: string;
  /** Ancho de relleno usado (mínimo 3, o el mayor observado). */
  width: number;
  /** Esqueleto de ruta sugerido al que el LLM solo añade el slug + ".md". */
  prefijoSugerido: string;
  /** Documentos numerados que ya existen, ordenados; sirven de ancla para upsert por ruta exacta. */
  existentes: { numero: string; ruta: string }[];
}

/**
 * Núcleo puro y testeable: dado un listado de rutas relativas, el prefijo y la carpeta, devuelve
 * el siguiente número libre (máximo existente + 1) y la lista de los que ya existen.
 */
export function computeNextNumber(
  relPaths: string[],
  prefix: string,
  folder: string,
): NextNumberResult {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
  const folderNorm = norm(folder).replace(/\/+$/, "");
  const pfx = prefix.trim().toUpperCase().replace(/-+$/, "");
  const re = new RegExp(`^${escapeRegExp(folderNorm)}/${escapeRegExp(pfx)}-(\\d+)`, "i");

  const found: { num: number; ruta: string; raw: string }[] = [];
  for (const rawPath of relPaths) {
    const p = norm(rawPath);
    const m = p.match(re);
    if (m) found.push({ num: Number.parseInt(m[1], 10), ruta: p, raw: m[1] });
  }
  found.sort((a, b) => a.num - b.num || a.ruta.localeCompare(b.ruta));

  const width = Math.max(3, ...found.map((f) => f.raw.length), 0);
  const max = found.reduce((acc, f) => Math.max(acc, f.num), 0);
  const next = max + 1;
  const nextPadded = String(next).padStart(width, "0");

  return {
    prefix: pfx,
    folder: folderNorm,
    next,
    nextPadded,
    width,
    prefijoSugerido: `${folderNorm}/${pfx}-${nextPadded}-`,
    existentes: found.map((f) => ({ numero: f.raw, ruta: f.ruta })),
  };
}

/** Resuelve la carpeta efectiva: la que pasa el llamante o la canónica del prefijo. */
function resolveFolder(prefix: string, folder?: string): string {
  const pfx = prefix.trim().toUpperCase().replace(/-+$/, "");
  const fld = (folder ?? "").trim().replace(/^\/+|\/+$/g, "") || DEFAULT_FOLDER[pfx] || "";
  if (!pfx) throw new Error("prefijo vacío");
  if (!fld)
    throw new Error(`indica la carpeta para el prefijo ${pfx} (no tiene carpeta por defecto)`);
  return fld;
}

/** Lee los .md de una carpeta del proyecto y calcula el siguiente número libre. */
export async function nextDocNumberInDir(
  rootPath: string,
  prefix: string,
  folder?: string,
): Promise<NextNumberResult> {
  const fld = resolveFolder(prefix, folder);
  const dir = path.join(rootPath, fld);
  let names: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => `${fld}/${e.name}`);
  } catch {
    // La carpeta aún no existe → empezamos en el primer número libre.
  }
  return computeNextNumber(names, prefix, fld);
}

/** Igual que {@link nextDocNumberInDir} pero resolviendo la raíz a partir del ID de proyecto. */
export async function nextDocNumberForProject(
  projectId: string,
  prefix: string,
  folder?: string,
): Promise<NextNumberResult> {
  const row = (
    await db()
      .select({ rootPath: schema.projects.rootPath })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1)
  )[0];
  if (!row) throw new Error(`proyecto ${projectId} no encontrado`);
  return nextDocNumberInDir(row.rootPath, prefix, folder);
}
