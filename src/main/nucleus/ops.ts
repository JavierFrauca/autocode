import type { NucleusEngine } from "./engine.js";

/**
 * Operaciones de alto nivel sobre el motor (se ejecutan SIEMPRE dentro del worker). Resuelven
 * dominios por nombre (get-or-create, cacheado), hacen ingest idempotente por `source` (borran el
 * documento previo con esa fuente antes de re-ingestar) y buscan en varios dominios fusionando por score.
 */

const domainCache = new Map<string, number>();

function refreshDomainCache(eng: NucleusEngine): void {
  for (const d of eng.listDomains().domains ?? []) domainCache.set(d.name, d.id);
}

/** id del dominio por nombre (get-or-create), con caché. */
export function ensureDomain(eng: NucleusEngine, name: string): number {
  const cached = domainCache.get(name);
  if (cached !== undefined) return cached;
  refreshDomainCache(eng);
  const again = domainCache.get(name);
  if (again !== undefined) return again;
  const id = eng.createDomain(name).id as number;
  domainCache.set(name, id);
  return id;
}

/** id del dominio si existe, o null (sin crearlo) — para búsquedas. */
function domainIdIfExists(eng: NucleusEngine, name: string): number | null {
  if (domainCache.has(name)) return domainCache.get(name)!;
  refreshDomainCache(eng);
  return domainCache.has(name) ? domainCache.get(name)! : null;
}

/** Borra los documentos cuyo `source` coincide (re-indexado idempotente). Devuelve cuántos borró. */
export function deleteBySource(eng: NucleusEngine, domainId: number, source: string): number {
  let removed = 0;
  let offset = 0;
  const limit = 200;
  for (;;) {
    const docs = eng.listDocuments(domainId, offset, limit).documents ?? [];
    for (const d of docs) {
      if (d.source === source) {
        try { eng.deleteDocument(d.id); removed++; } catch { /* sigue */ }
      }
    }
    if (docs.length < limit) break;
    offset += limit;
  }
  return removed;
}

export interface IngestArgs {
  source: string;
  title: string;
  text: string;
  metadata?: Record<string, string>;
  labels?: string[];
}

/** Ingesta un documento en un dominio (borra primero el previo con la misma `source`). */
export function ingestDoc(eng: NucleusEngine, domain: string, args: IngestArgs): { document_id: number; chunk_count: number } {
  const domainId = ensureDomain(eng, domain);
  deleteBySource(eng, domainId, args.source);
  return eng.ingestText({
    domain_id: domainId,
    title: args.title,
    text: args.text,
    source: args.source,
    metadata: args.metadata,
    labels: args.labels,
  });
}

/** Borra de un dominio los documentos con esa `source`. */
export function deleteDoc(eng: NucleusEngine, domain: string, source: string): number {
  const id = domainIdIfExists(eng, domain);
  if (id === null) return 0;
  return deleteBySource(eng, id, source);
}

export interface RawHit {
  score: number;
  text: string;
  metadata: Record<string, string>;
}

// MMR por defecto: penaliza un poco la redundancia entre fragmentos del contexto (más variedad, menos
// repetir lo mismo). 0 = pura relevancia; subirlo da más diversidad a cambio de algo de relevancia.
const SEARCH_DIVERSITY = 0.3;

/** Busca en varios dominios A LA VEZ (una sola llamada al motor, con fusión + MMR). */
export function searchDomains(eng: NucleusEngine, domains: string[], query: string, k: number): RawHit[] {
  // Resolver nombres → ids SIN crear los que falten (un dominio inexistente no aporta resultados).
  const ids: number[] = [];
  for (const name of domains) {
    const id = domainIdIfExists(eng, name);
    if (id !== null) ids.push(id);
  }
  if (ids.length === 0) return [];
  const r = eng.searchMulti({ domain_ids: ids, query, k, diversity: SEARCH_DIVERSITY });
  return (r.hits ?? []).map((h) => ({
    score: h.score,
    text: h.chunk?.text ?? "",
    metadata: h.chunk?.metadata ?? {},
  }));
}

/** Borra un dominio entero por nombre (cascada). Devuelve 1 si existía, 0 si no. */
export function deleteDomainByName(eng: NucleusEngine, name: string): number {
  const id = domainIdIfExists(eng, name);
  if (id === null) return 0;
  eng.deleteDomain(id);
  domainCache.delete(name);
  return 1;
}

/** Olvida la caché de dominios (p.ej. si el motor se reabre). */
export function resetDomainCache(): void {
  domainCache.clear();
}
