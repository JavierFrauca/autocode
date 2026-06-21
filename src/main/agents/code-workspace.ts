import { promises as fs } from "node:fs";
import path from "node:path";
import { isSafeRelative, safeResolve } from "../util/paths.js";
import type { ChatTool } from "../llm/client.js";

/**
 * Acceso controlado al código de la app generada (`_app/`). Lo usan el reparador por contexto (B)
 * y, sobre todo, el reparador por tools (A), que navega y edita CUALQUIER fichero del código para
 * arreglar errores de compilación. Todo queda acotado a `_app/` y bloquea `tests/` (de QA) y
 * `node_modules/`.
 */

/** Workspace donde se materializa la app generada (`_app/` dentro del proyecto). */
export function appWorkspace(rootPath: string): string {
  return path.join(rootPath, "_app");
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

export async function listAppFiles(ws: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  }
  await walk(ws, "");
  return out.sort();
}

export async function readAppFile(ws: string, rel: string): Promise<string | null> {
  const abs = isSafeRelative(rel) ? safeResolve(ws, rel) : null;
  if (!abs) return null;
  try { return await fs.readFile(abs, "utf-8"); } catch { return null; }
}

/** Escribe un fichero del código. Bloquea tests/ (propiedad de QA) y node_modules/. */
export async function writeAppFile(ws: string, rel: string, content: string): Promise<boolean> {
  if (!isSafeRelative(rel)) return false;
  const norm = rel.replace(/\\/g, "/");
  if (norm === "tests" || norm.startsWith("tests/") || norm.startsWith("node_modules/")) return false;
  const abs = safeResolve(ws, rel);
  if (!abs) return false;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return true;
}

/** Borra un fichero del código. Bloquea tests/ y node_modules/ (mismo guard que writeAppFile). */
export async function deleteAppFile(ws: string, rel: string): Promise<boolean> {
  if (!isSafeRelative(rel)) return false;
  const norm = rel.replace(/\\/g, "/");
  if (norm === "tests" || norm.startsWith("tests/") || norm.startsWith("node_modules/")) return false;
  const abs = safeResolve(ws, rel);
  if (!abs) return false;
  try { await fs.unlink(abs); return true; } catch { return false; }
}

/** Tools de workspace para el reparador (A): listar / leer / escribir el código de la app. */
export function buildCodeTools(ws: string): ChatTool[] {
  return [
    {
      name: "listar_ficheros",
      description: "Lista todas las rutas de los ficheros de código de la app.",
      parameters: { type: "object", properties: {} },
      run: async () => JSON.stringify(await listAppFiles(ws)),
    },
    {
      name: "leer_fichero",
      description: "Devuelve el contenido completo de un fichero de la app por su ruta relativa.",
      parameters: {
        type: "object",
        properties: { ruta: { type: "string", description: "Ruta relativa, p.ej. src/index.ts" } },
        required: ["ruta"],
      },
      run: async (a) => {
        const c = await readAppFile(ws, a.ruta);
        return c == null ? `No se pudo leer "${a.ruta}".` : c;
      },
    },
    {
      name: "escribir_fichero",
      description:
        "Crea o REEMPLAZA un fichero de la app con el contenido completo dado. Úsalo para aplicar " +
        "las correcciones. Puedes tocar cualquier fichero salvo tests/ y node_modules/.",
      parameters: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta relativa del fichero" },
          contenido: { type: "string", description: "Contenido COMPLETO del fichero corregido" },
        },
        required: ["ruta", "contenido"],
      },
      run: async (a) => {
        const ok = await writeAppFile(ws, a.ruta, a.contenido ?? "");
        return ok ? `Guardado "${a.ruta}".` : `Ruta no permitida: "${a.ruta}".`;
      },
    },
    {
      name: "borrar_fichero",
      description:
        "Borra un fichero de la app por su ruta relativa. Úsalo para ELIMINAR código muerto que " +
        "reemplazas (p.ej. el demo 'items' del andamiaje al meter el dominio real). NO borres la " +
        "infraestructura del andamiaje (auth/, audit, la cáscara, db.ts). No puede tocar tests/ ni node_modules/.",
      parameters: {
        type: "object",
        properties: { ruta: { type: "string", description: "Ruta relativa del fichero a borrar" } },
        required: ["ruta"],
      },
      run: async (a) => {
        const ok = await deleteAppFile(ws, a.ruta);
        return ok ? `Borrado "${a.ruta}".` : `No se pudo borrar "${a.ruta}" (no existe o ruta no permitida).`;
      },
    },
  ];
}
