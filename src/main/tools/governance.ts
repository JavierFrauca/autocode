import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { deleteProjectDocument, safeRelPath, saveProjectDocument } from "../papers/save.js";

/**
 * Gobernanza de los ficheros del proyecto por CATEGORÍA, para que el chat (y el MCP) puedan gestionarlos.
 * Categorías de DOCUMENTO (papers .md indexados en la tabla `documents`): decisiones, reglas, pantallas,
 * patrones — se crean/editan/borran igual. Media (imágenes) y planes (solo lectura) van aparte.
 * Las escrituras pasan por `saveProjectDocument`/`deleteProjectDocument` para mantener disco+BD+índice en sync.
 */

export const DOC_CATEGORIES = ["decisiones", "reglas", "pantallas", "patrones"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

async function projectRoot(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ rootPath: schema.projects.rootPath })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.rootPath ?? null;
}

/** ¿La ruta (relativa, saneada) cae dentro de la carpeta de la categoría? */
function inCategory(ruta: string, category: DocCategory): boolean {
  const norm = (safeRelPath(ruta) ?? "").replace(/\\/g, "/");
  return norm === category || norm.startsWith(category + "/");
}

function withinRoot(root: string, ruta: string): string | null {
  const rel = safeRelPath(ruta);
  if (!rel) return null;
  const abs = path.resolve(root, rel);
  if (!abs.toLowerCase().startsWith(path.resolve(root).toLowerCase())) return null;
  return abs;
}

// ── Categorías de DOCUMENTO (.md indexados) ──────────────────────────────────────────────────────

/** Lista los papers .md de una categoría (lee la carpeta: refleja los ficheros reales). */
export async function listCategoryDocs(projectId: string, category: DocCategory): Promise<{ ruta: string }[]> {
  const root = await projectRoot(projectId);
  if (!root) return [];
  let names: string[];
  try { names = await fs.readdir(path.join(root, category)); } catch { return []; }
  return names
    .filter((n) => n.toLowerCase().endsWith(".md"))
    .sort()
    .map((n) => ({ ruta: `${category}/${n}` }));
}

/** Lee el contenido completo de un paper por su ruta dentro de la categoría. */
export async function readCategoryDoc(projectId: string, category: DocCategory, ruta: string): Promise<string | null> {
  if (!inCategory(ruta, category)) return null;
  const root = await projectRoot(projectId);
  if (!root) return null;
  const abs = withinRoot(root, ruta);
  if (!abs) return null;
  try { return await fs.readFile(abs, "utf-8"); } catch { return null; }
}

/** Crea o actualiza (upsert por ruta) un paper de la categoría. Sincroniza disco + BD + índice. */
export async function saveCategoryDoc(
  cfg: AppConfig, projectId: string, category: DocCategory,
  ruta: string, contenido: string, titulo?: string, tags?: string[],
): Promise<{ ruta: string; created: boolean }> {
  if (!inCategory(ruta, category)) throw new Error(`La ruta debe estar dentro de ${category}/`);
  const r = await saveProjectDocument(cfg, projectId, { ruta, contenido, titulo, tags });
  return { ruta: r.ruta, created: r.created };
}

/** Borra un paper de la categoría (disco + BD + índice). */
export async function deleteCategoryDoc(cfg: AppConfig, projectId: string, category: DocCategory, ruta: string): Promise<void> {
  if (!inCategory(ruta, category)) throw new Error(`La ruta debe estar dentro de ${category}/`);
  await deleteProjectDocument(cfg, projectId, ruta);
}

// ── MEDIA (imágenes; no en la tabla documents — listar/borrar, NO subir desde el chat) ───────────

const MEDIA_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico"]);

function safeMediaName(raw: string): string {
  return path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}

export async function listMedia(projectId: string): Promise<{ nombre: string; bytes: number; ruta: string }[]> {
  const root = await projectRoot(projectId);
  if (!root) return [];
  const dir = path.join(root, "media");
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: { nombre: string; bytes: number; ruta: string }[] = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith(".") || !MEDIA_EXT.has(path.extname(e.name).toLowerCase())) continue;
    const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
    out.push({ nombre: e.name, bytes: stat?.size ?? 0, ruta: `media/${e.name}` });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function deleteMedia(projectId: string, filename: string): Promise<boolean> {
  const root = await projectRoot(projectId);
  if (!root) return false;
  try { await fs.unlink(path.join(root, "media", safeMediaName(filename))); return true; } catch { return false; }
}

// ── PLANES (solo lectura: plan.md vivo + informes de ejecución) ──────────────────────────────────

export async function listPlanes(projectId: string): Promise<string[]> {
  const root = await projectRoot(projectId);
  if (!root) return [];
  try { return (await fs.readdir(path.join(root, "planes"))).filter((n) => n.toLowerCase().endsWith(".md")).sort(); }
  catch { return []; }
}

export async function readPlanFile(projectId: string, filename: string): Promise<string | null> {
  const root = await projectRoot(projectId);
  if (!root) return null;
  try { return await fs.readFile(path.join(root, "planes", path.basename(filename)), "utf-8"); }
  catch { return null; }
}
