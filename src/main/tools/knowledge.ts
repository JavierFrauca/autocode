import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq, isNull } from "drizzle-orm";
import { app as electronApp } from "electron";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { QdrantClient } from "../qdrant/client.js";
import { LIBRARY_COLLECTION, TEMPLATES_COLLECTION } from "../qdrant/collections.js";
import { embed } from "../llm/client.js";
import { safeResolve } from "../util/paths.js";

/**
 * Capacidades de conocimiento de AutoCode como funciones puras (datos estructurados).
 * Las consume TANTO el servidor MCP (routes/mcp.ts, para LLMs externos) COMO el chat
 * interno (auto-RAG + tool-calling). Una sola implementación, dos consumidores.
 */

export interface DocSearchHit {
  score: number;
  title: string | null;
  path: string | null;
  heading: unknown;
  text: string;
  documentId: string | null;
  projectId: string | null;
}

export interface KbHit {
  score: number;
  source: string;
  filePath: string | null;
  heading: unknown;
  text: string;
}

function resolveKbDir(source: "library" | "templates"): string {
  if (electronApp.isPackaged) return path.join(process.resourcesPath, source);
  return path.resolve(__dirname, "../..", source);
}

async function walkMdFiles(dir: string, rel = ""): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) result.push(...(await walkMdFiles(path.join(dir, e.name), relPath)));
      else if (e.name.endsWith(".md")) result.push(relPath);
    }
  } catch {}
  return result;
}

export async function listProjects() {
  return db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      description: schema.projects.description,
      rootPath: schema.projects.rootPath,
    })
    .from(schema.projects)
    .where(isNull(schema.projects.deletedAt));
}

export async function listDocuments(projectId: string) {
  return db()
    .select({
      id: schema.documents.id,
      path: schema.documents.path,
      title: schema.documents.title,
      tags: schema.documents.tags,
      status: schema.documents.status,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, projectId));
}

export async function getDocument(documentId: string) {
  const doc = (
    await db().select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1)
  )[0];
  if (!doc) return null;
  const rev = (
    await db()
      .select({ body: schema.documentRevisions.body, createdAt: schema.documentRevisions.createdAt })
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, documentId))
      .orderBy(desc(schema.documentRevisions.createdAt))
      .limit(1)
  )[0];
  return {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    tags: doc.tags,
    status: doc.status,
    updatedAt: doc.updatedAt,
    content: rev?.body ?? "(sin contenido)",
  };
}

export interface SearchDocumentsResult {
  ok: boolean;
  error?: string;
  hits: DocSearchHit[];
}

export async function searchDocuments(
  opts: { query: string; projectId?: string; topK?: number },
  cfg?: AppConfig,
): Promise<SearchDocumentsResult> {
  const config = cfg ?? (await loadConfig());
  // Embeddings locales siempre disponibles (sin gate de configuración de usuario).

  let vector: number[] | undefined;
  try {
    vector = (await embed(config, [opts.query], "knowledge-search", { interactive: true }))[0];
  } catch (e: any) {
    return { ok: false, error: `error generando embedding: ${e?.message ?? e}`, hits: [] };
  }
  if (!vector) return { ok: false, error: "embedding vacío", hits: [] };

  let collections: string[];
  if (opts.projectId) {
    const p = (
      await db()
        .select({ c: schema.projects.qdrantCollection })
        .from(schema.projects)
        .where(eq(schema.projects.id, opts.projectId))
        .limit(1)
    )[0];
    if (!p) return { ok: false, error: `proyecto ${opts.projectId} no encontrado`, hits: [] };
    collections = [p.c];
  } else {
    const projects = await db()
      .select({ c: schema.projects.qdrantCollection })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt));
    collections = projects.map((p) => p.c);
  }
  if (collections.length === 0) return { ok: true, hits: [] };

  const qdrant = new QdrantClient(config.qdrantUrl);
  const hits = await qdrant.searchMulti(collections, vector, opts.topK ?? 5);
  return {
    ok: true,
    hits: hits.map((h) => ({
      score: Math.round(h.score * 1000) / 1000,
      title: (h.payload["title"] as string) ?? null,
      path: (h.payload["path"] as string) ?? null,
      heading: h.payload["heading_path"] ?? null,
      text: (h.payload["text"] as string) ?? "",
      documentId: (h.payload["document_id"] as string) ?? null,
      projectId: (h.payload["project_id"] as string) ?? null,
    })),
  };
}

export async function listKnowledgeBase(source: "library" | "templates"): Promise<string[]> {
  return walkMdFiles(resolveKbDir(source));
}

export async function getKnowledgeBaseFile(
  source: "library" | "templates",
  filePath: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const dir = resolveKbDir(source);
  const abs = safeResolve(dir, filePath);
  if (!abs) return { ok: false, error: "ruta no permitida" };
  try {
    return { ok: true, content: await fs.readFile(abs, "utf-8") };
  } catch {
    return { ok: false, error: `fichero no encontrado: ${filePath}` };
  }
}

export interface SearchKbResult {
  ok: boolean;
  error?: string;
  hits: KbHit[];
}

export async function searchKnowledgeBase(
  opts: { query: string; source?: "library" | "templates" | "all"; topK?: number },
  cfg?: AppConfig,
): Promise<SearchKbResult> {
  const config = cfg ?? (await loadConfig());
  // Embeddings locales siempre disponibles (sin gate de configuración de usuario).
  let vector: number[] | undefined;
  try {
    vector = (await embed(config, [opts.query], "knowledge-kb-search", { interactive: true }))[0];
  } catch (e: any) {
    return { ok: false, error: `error generando embedding: ${e?.message ?? e}`, hits: [] };
  }
  if (!vector) return { ok: false, error: "embedding vacío", hits: [] };

  const source = opts.source ?? "all";
  const collections: string[] = [];
  if (source === "library" || source === "all") collections.push(LIBRARY_COLLECTION);
  if (source === "templates" || source === "all") collections.push(TEMPLATES_COLLECTION);

  const qdrant = new QdrantClient(config.qdrantUrl);
  const hits = await qdrant.searchMulti(collections, vector, opts.topK ?? 5);
  return {
    ok: true,
    hits: hits.map((h) => ({
      score: Math.round(h.score * 1000) / 1000,
      source: (h.payload["collection_type"] as string) ?? "unknown",
      filePath: (h.payload["file_path"] as string) ?? null,
      heading: h.payload["heading_path"] ?? null,
      text: (h.payload["text"] as string) ?? "",
    })),
  };
}
