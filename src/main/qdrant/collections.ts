import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EMBEDDINGS_DIM } from "@shared";
import { loadConfig } from "../config.js";
import { QdrantClient } from "./client.js";
import { chunkMarkdown } from "../papers/ingest.js";

export const LIBRARY_COLLECTION = "__library__";
export const TEMPLATES_COLLECTION = "__templates__";

import { app } from "electron";

function resolveStaticDir(name: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, name);
  }
  // dev: __dirname is <project>/out/main/, two levels up is project root
  return path.resolve(__dirname, "../..", name);
}

function libraryDir(): string {
  return resolveStaticDir("library");
}

function templatesDir(): string {
  return resolveStaticDir("templates");
}

/** Walk directory recursively, return relative .md paths */
async function walkMd(dir: string, rel = ""): Promise<{ relPath: string; absPath: string }[]> {
  const result: { relPath: string; absPath: string }[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const absPath = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        result.push(...await walkMd(absPath, relPath));
      } else if (e.name.endsWith(".md")) {
        result.push({ relPath, absPath });
      }
    }
  } catch {}
  return result;
}

/** Sentinela de `indexFile`: el fichero ya estaba indexado con el mismo contenido (no se tocó nada). */
const UNCHANGED = -1;

/**
 * Indexa UN fichero .md (borra sus puntos previos por `file_path` y vuelve a chunkear+embeber+subir).
 * Reutilizado por el indexado de arranque y por el reindexado al editar en la UI: una sola verdad,
 * sin que las dos rutas diverjan. Devuelve cuántos chunks indexó (0 si el fichero está vacío o el
 * embed no cuadra), o `UNCHANGED` (-1) si el hash coincide con lo ya indexado y se saltó el trabajo.
 */
async function indexFile(
  qdrant: QdrantClient,
  collection: string,
  dir: string,
  relPath: string,
  cfg: any,
  extraPayload: Record<string, unknown>,
): Promise<number> {
  const content = await fs.readFile(path.join(dir, relPath), "utf-8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

  // Salto idempotente: si ya hay puntos de este fichero con el mismo `file_hash`, el contenido no ha
  // cambiado desde el último indexado → ni borramos ni re-embebemos (re-embeber el corpus entero en
  // CPU es el grueso del coste de arranque). Best-effort: si la consulta falla, seguimos al reindexado.
  try {
    const prev = await qdrant.scrollPayloads(
      collection,
      { must: [{ key: "file_path", match: { value: relPath } }] },
      1,
    );
    if (prev[0]?.file_hash === hash) return UNCHANGED;
  } catch {}

  // Borra los puntos previos de este fichero (reindexado idempotente).
  try {
    await qdrant.deleteByFilter(collection, {
      must: [{ key: "file_path", match: { value: relPath } }],
    });
  } catch {}

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) return 0;

  const { embed } = await import("../llm/client.js");
  const vectors = await embed(cfg, chunks.map((c) => c.text), "library-index");
  if (vectors.length !== chunks.length) return 0;

  const points = chunks.map((c, i) => ({
    id: randomUUID(), // Qdrant exige UUID o entero como point id (un ULID da 400)
    vector: vectors[i]!,
    payload: {
      file_path: relPath,
      file_hash: hash,
      heading_path: c.headingPath,
      text: c.text,
      chunk_index: i,
      ...extraPayload,
    },
  }));

  await qdrant.upsert(collection, points);
  return points.length;
}

async function indexCollection(
  qdrant: QdrantClient,
  collection: string,
  dir: string,
  dim: number,
  cfg: any,
  extraPayload: Record<string, unknown> = {},
): Promise<void> {
  await qdrant.ensureCollection(collection, dim);
  const files = await walkMd(dir);
  if (files.length === 0) return;

  // Reindexa por fichero, pero saltando los que no cambiaron (ver `indexFile`): el primer arranque
  // embebe todo; los siguientes solo tocan lo editado, así el arranque deja de re-embeber el corpus.
  let indexed = 0;
  let skipped = 0;
  for (const { relPath } of files) {
    const n = await indexFile(qdrant, collection, dir, relPath, cfg, extraPayload);
    if (n === UNCHANGED) {
      skipped++;
    } else if (n > 0) {
      indexed++;
      console.log(`[collections] indexed ${collection}/${relPath} (${n} chunks)`);
    }
  }
  console.log(`[collections] ${collection}: ${indexed} (re)indexados, ${skipped} sin cambios de ${files.length}`);
}

/** Payload extra por catálogo (debe coincidir con el del indexado de arranque). */
function kbPayload(source: "library" | "templates"): Record<string, unknown> {
  return source === "library"
    ? { collection_type: "library" }
    : { collection_type: "template", transversal: true };
}

/**
 * Reindexa UN fichero de la biblioteca/plantillas tras editarlo en la UI. Sin esto, el `PUT` de
 * routes/library.ts escribe el .md pero el RAG seguiría sirviendo el chunk viejo hasta el próximo
 * arranque. Best-effort: si no hay embeddings configurados o Qdrant falla, el llamante lo ignora
 * (el guardado del fichero no debe romperse por el índice).
 */
export async function reindexKbFile(source: "library" | "templates", relPath: string): Promise<void> {
  const cfg = await loadConfig();
  const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel.endsWith(".md")) return;

  const dir = source === "library" ? libraryDir() : templatesDir();
  const abs = path.normalize(path.join(dir, rel));
  if (abs !== path.normalize(dir) && !abs.startsWith(path.normalize(dir) + path.sep)) return; // no salir del catálogo

  const collection = source === "library" ? LIBRARY_COLLECTION : TEMPLATES_COLLECTION;
  const qdrant = new QdrantClient(cfg.qdrantUrl);
  await qdrant.ensureCollection(collection, EMBEDDINGS_DIM);
  const n = await indexFile(qdrant, collection, dir, rel, cfg, kbPayload(source));
  console.log(
    n === UNCHANGED
      ? `[collections] ${collection}/${rel} sin cambios (no reindexado)`
      : `[collections] reindexed ${collection}/${rel} (${n} chunks)`,
  );
}

export async function startCollectionsIndex(): Promise<void> {
  const cfg = await loadConfig();
  const qdrant = new QdrantClient(cfg.qdrantUrl);
  const dim = EMBEDDINGS_DIM;

  // Index library
  await indexCollection(qdrant, LIBRARY_COLLECTION, libraryDir(), dim, cfg, {
    collection_type: "library",
  });

  // Index templates
  await indexCollection(qdrant, TEMPLATES_COLLECTION, templatesDir(), dim, cfg, {
    collection_type: "template",
    transversal: true,
  });
}
