import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { ingestRevision } from "./ingest.js";
import { nucleusDeleteDoc } from "../nucleus/client.js";
import { projectDomain } from "../nucleus/domains.js";
import { ensureScreenFrontmatter, isScreenSpecPath } from "../screens/meta.js";
import { log } from "../log.js";

/**
 * Único camino de escritura de documentos de proyecto: disco + tabla `documents` + revisión +
 * índice semántico (Qdrant). Lo usan el documenter, la tool del chat y el MCP. Antes esta lógica
 * vivía duplicada dentro del documenter; ahora es compartida para que "guardar un doc" sea una
 * sola cosa, hagas lo que hagas desde donde lo hagas.
 */

export function safeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\./g, "").slice(0, 200);
}

export function extractTitle(content: string, fallbackPath: string): string {
  const m = content.match(/^#\s+(.+)$/m) || content.match(/^title:\s*(.+)$/im);
  return (m?.[1] ?? path.basename(fallbackPath, ".md")).trim().slice(0, 200);
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Proyecto ${projectId} no encontrado`);
  return rows[0];
}

export interface SaveDocInput {
  ruta: string;
  contenido: string;
  titulo?: string;
  tags?: string[];
  coleccion?: "project" | "templates";
  agentRunId?: string | null;
}

export interface SavedDoc {
  docId: string;
  revId: string;
  ruta: string;
  created: boolean;
}

/** Guarda (crea o actualiza) un documento de proyecto. Idempotente por ruta: misma ruta → upsert. */
export async function saveProjectDocument(
  cfg: AppConfig,
  projectId: string,
  input: SaveDocInput,
): Promise<SavedDoc> {
  const project = await getProject(projectId);
  const ruta = safeRelPath(input.ruta ?? "");
  if (!ruta) throw new Error("ruta vacía o inválida");
  if (!ruta.endsWith(".md")) throw new Error("la ruta debe terminar en .md");
  let contenido = input.contenido ?? "";
  if (!contenido.trim()) throw new Error("contenido vacío");
  // Toda pantalla, venga de donde venga, queda con frontmatter de jerarquía (suelo de consistencia).
  if (isScreenSpecPath(ruta)) contenido = ensureScreenFrontmatter(contenido);

  // Anti path-traversal: el fichero debe quedar dentro de la carpeta del proyecto.
  const rootNorm = path.resolve(project.rootPath).toLowerCase();
  const absPath = path.resolve(project.rootPath, ruta);
  if (!absPath.toLowerCase().startsWith(rootNorm)) {
    throw new Error(`ruta fuera del proyecto: ${ruta}`);
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, contenido, "utf-8");

  const title = input.titulo?.trim() || extractTitle(contenido, ruta);
  const existing = await db()
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, ruta)));

  let docId: string;
  let created = false;
  if (existing[0]) {
    docId = existing[0].id;
    await db().update(schema.documents)
      .set({ title, tags: input.tags ?? [], status: "active", deletedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, docId));
  } else {
    docId = `doc_${ulid().toLowerCase()}`;
    created = true;
    await db().insert(schema.documents).values({
      id: docId, projectId, path: ruta, title, tags: input.tags ?? [], status: "active",
    });
  }

  const revId = `rev_${ulid().toLowerCase()}`;
  await db().insert(schema.documentRevisions).values({
    id: revId, documentId: docId, projectId, body: contenido,
    authorRole: "agent", agentRunId: input.agentRunId ?? null,
  });

  const collection = input.coleccion === "templates" ? "__templates__" : project.qdrantCollection;
  try {
    await ingestRevision(cfg, projectId, collection, docId, revId, ruta, title, contenido);
  } catch (e) {
    log.warn("save", "indexado en Nucleus falló (el fichero se guardó igual en disco y BD)", { err: e, ruta });
  }

  return { docId, revId, ruta, created };
}

/** Borra un documento de proyecto: disco + marca borrado en BD + saca del índice. */
export async function deleteProjectDocument(
  cfg: AppConfig,
  projectId: string,
  rutaRaw: string,
): Promise<void> {
  const project = await getProject(projectId);
  const ruta = safeRelPath(rutaRaw);
  if (!ruta) return;
  const rootNorm = path.resolve(project.rootPath).toLowerCase();
  const absPath = path.resolve(project.rootPath, ruta);
  if (!absPath.toLowerCase().startsWith(rootNorm)) return;

  try { await fs.unlink(absPath); } catch { /* puede no existir */ }

  const existing = await db()
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, ruta)));
  if (!existing[0]) return;
  const docId = existing[0].id;

  try {
    await nucleusDeleteDoc(projectDomain(projectId), ruta);
  } catch (e) {
    log.warn("save", "no se pudo limpiar el índice al borrar", { err: e, ruta });
  }
  await db().update(schema.documents)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.documents.id, docId));
}
