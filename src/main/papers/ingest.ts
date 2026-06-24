import type { AppConfig } from "@shared";
import { nucleusIngestDoc } from "../nucleus/client.js";
import { domainForCollection } from "../nucleus/domains.js";

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

/**
 * Indexa (o re-indexa) un documento en Nucleus. El motor trocea, embebe e indexa internamente, así que
 * NO troceamos aquí; pasamos el texto entero. Idempotente por `source` (la ruta): el ingest borra el
 * documento previo con esa fuente antes de meter el nuevo. `cfg`/`revisionId` se mantienen por
 * compatibilidad de firma (los llamantes no cambian). Devuelve cuántos chunks generó Nucleus.
 */
export async function ingestRevision(
  _cfg: AppConfig,
  projectId: string,
  collection: string,
  documentId: string,
  _revisionId: string,
  documentPath: string,
  documentTitle: string,
  body: string,
): Promise<number> {
  if (!body.trim()) return 0;
  const domain = domainForCollection(projectId, collection);
  const r = await nucleusIngestDoc(domain, {
    source: documentPath,
    title: documentTitle,
    text: body,
    // La metadata se hereda en los chunks → la búsqueda recupera path/título/ids sin re-consultar.
    metadata: { path: documentPath, title: documentTitle, document_id: documentId, project_id: projectId },
    labels: [documentPath.split("/")[0] ?? "doc"],
  });
  return r.chunk_count ?? 0;
}
