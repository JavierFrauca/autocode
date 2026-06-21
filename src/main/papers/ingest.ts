import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "@shared";
import { EMBEDDINGS_DIM } from "@shared";
import { db, schema } from "../db/client.js";
import { embed } from "../llm/client.js";
import { QdrantClient } from "../qdrant/client.js";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

/**
 * Allowlist de carpetas de DOCUMENTOS que SÍ se indexan en Qdrant. Regla en POSITIVO (más segura
 * que ir excluyendo): solo entra lo que vive en una de estas carpetas. Así nunca se cuela código
 * generado (`_app/`), dependencias (`node_modules`), historial, planes, media, etc.
 */
export const DOC_DIRS = ["decisiones", "reglas", "pantallas", "patrones", "dominios", "procesos", "aportados", "tecnicos"];

/** ¿Esta ruta relativa es un documento de proyecto indexable? (solo `.md` dentro de DOC_DIRS) */
export function isDocPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p.endsWith(".md") || p.includes("node_modules")) return false;
  // La fuente CRUDA de un documento técnico (`*.fuente.md`) es un artefacto recuperable, NO se indexa
  // (solo se indexa el paper destilado DT-NNN, su hermano sin sufijo).
  if (p.endsWith(".fuente.md")) return false;
  return DOC_DIRS.includes(p.split("/")[0]);
}

export function chunkMarkdown(body: string): { text: string; headingPath: string | null }[] {
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; text: string } = { heading: null, text: "" };
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (current.text.trim()) sections.push(current);
      current = { heading: m[2]?.trim() ?? null, text: "" };
    } else {
      current.text += line + "\n";
    }
  }
  if (current.text.trim()) sections.push(current);

  const chunks: { text: string; headingPath: string | null }[] = [];
  for (const s of sections) {
    const t = s.text.trim();
    if (!t) continue;
    if (t.length <= CHUNK_SIZE) {
      chunks.push({ text: t, headingPath: s.heading });
      continue;
    }
    let i = 0;
    while (i < t.length) {
      chunks.push({ text: t.slice(i, i + CHUNK_SIZE), headingPath: s.heading });
      i += CHUNK_SIZE - CHUNK_OVERLAP;
    }
  }
  return chunks;
}

export async function ingestRevision(
  cfg: AppConfig,
  projectId: string,
  collection: string,
  documentId: string,
  revisionId: string,
  documentPath: string,
  documentTitle: string,
  body: string,
): Promise<number> {
  const qdrant = new QdrantClient(cfg.qdrantUrl);
  await qdrant.ensureCollection(collection, EMBEDDINGS_DIM);

  // Remove old points for this document (we re-index the latest)
  await qdrant.deleteByFilter(collection, {
    must: [{ key: "document_id", match: { value: documentId } }],
  });
  await db()
    .delete(schema.embeddingsIndex)
    .where(
      and(
        eq(schema.embeddingsIndex.projectId, projectId),
        eq(schema.embeddingsIndex.documentId, documentId),
      ),
    );

  const chunks = chunkMarkdown(body);
  if (chunks.length === 0) return 0;

  const vectors = await embed(cfg, chunks.map((c) => c.text), "ingest");
  if (vectors.length !== chunks.length) throw new Error("Embed count mismatch");

  const points = chunks.map((c, i) => {
    // Qdrant SOLO acepta point ids que sean entero sin signo o UUID. Un ULID NO vale (da 400 y el
    // chunk no se indexa). Por eso usamos randomUUID.
    const pid = randomUUID();
    return {
      id: pid,
      vector: vectors[i]!,
      payload: {
        project_id: projectId,
        document_id: documentId,
        revision_id: revisionId,
        chunk_index: i,
        path: documentPath,
        title: documentTitle,
        heading_path: c.headingPath,
        text: c.text,
      },
    };
  });

  await qdrant.upsert(collection, points);

  await db()
    .insert(schema.embeddingsIndex)
    .values(
      points.map((p, i) => ({
        id: `eix_${p.id}`,
        projectId,
        documentId,
        revisionId,
        chunkIndex: i,
        qdrantPointId: p.id,
      })),
    );

  return points.length;
}
