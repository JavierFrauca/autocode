import { promises as fs } from "node:fs";
import path from "node:path";
import type { NucleusEngine } from "./engine.js";
import { ingestDoc, ensureDomain } from "./ops.js";
import { projectDomain, KB_LIBRARY_DOMAIN, KB_TEMPLATES_DOMAIN } from "./domains.js";

/**
 * Indexado diferido en Nucleus: recorre cada proyecto (sus `.md` en carpetas indexables) y los
 * catálogos transversales (library/templates), y los mete en sus dominios. Nucleus trocea, embebe e
 * indexa cada documento internamente; aquí solo leemos ficheros y llamamos a `ingestDoc`.
 */

// Allowlist de carpetas indexables (misma política que el indexado clásico). Replicada aquí para no
// arrastrar la cadena pesada de `papers/ingest` (sqlite, etc.) al worker.
const DOC_DIRS = ["decisiones", "reglas", "pantallas", "patrones", "dominios", "procesos", "aportados", "tecnicos"];

export interface ProjectRef {
  id: string;
  name: string;
  rootPath: string;
}

/** Rutas de los catálogos transversales (las resuelve el proceso main y las pasa al worker). */
export interface KbDirs {
  library?: string;
  templates?: string;
}

async function walkMd(dir: string, rel = ""): Promise<{ relPath: string; absPath: string }[]> {
  const out: { relPath: string; absPath: string }[] = [];
  try {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walkMd(absPath, relPath)));
      else if (e.name.endsWith(".md")) out.push({ relPath, absPath });
    }
  } catch { /* carpeta inexistente */ }
  return out;
}

async function indexProject(eng: NucleusEngine, p: ProjectRef): Promise<number> {
  const domain = projectDomain(p.id);
  let count = 0;
  for (const dir of DOC_DIRS) {
    const abs = path.join(p.rootPath, dir);
    let names: string[] = [];
    try {
      names = (await fs.readdir(abs)).filter(
        (n) => n.toLowerCase().endsWith(".md") && !n.toLowerCase().endsWith(".fuente.md"),
      );
    } catch { continue; }
    for (const name of names) {
      const rel = `${dir}/${name}`;
      let text: string;
      try { text = await fs.readFile(path.join(abs, name), "utf-8"); } catch { continue; }
      if (!text.trim()) continue;
      const title = name.replace(/\.md$/i, "").replace(/-/g, " ");
      ingestDoc(eng, domain, {
        source: rel,
        title,
        text,
        metadata: { path: rel, title, project_id: p.id },
        labels: [dir],
      });
      count++;
    }
  }
  return count;
}

async function indexKbDir(eng: NucleusEngine, domain: string, dir: string, collectionType: string): Promise<number> {
  let count = 0;
  for (const { relPath, absPath } of await walkMd(dir)) {
    let text: string;
    try { text = await fs.readFile(absPath, "utf-8"); } catch { continue; }
    if (!text.trim()) continue;
    ingestDoc(eng, domain, {
      source: relPath,
      title: relPath,
      text,
      metadata: { collection_type: collectionType, file_path: relPath },
    });
    count++;
  }
  return count;
}

export interface IndexAllResult {
  projects: number;
  documents: number;
  kb: number;
}

/** Indexa todos los proyectos y los catálogos, y vuelca los índices a disco. */
export async function indexAll(eng: NucleusEngine, projects: ProjectRef[], kb: KbDirs = {}): Promise<IndexAllResult> {
  let documents = 0;
  for (const p of projects) {
    try { documents += await indexProject(eng, p); } catch { /* uno que falle no aborta el resto */ }
  }
  let kbDocs = 0;
  try { if (kb.library) kbDocs += await indexKbDir(eng, KB_LIBRARY_DOMAIN, kb.library, "library"); } catch { /* */ }
  try { if (kb.templates) kbDocs += await indexKbDir(eng, KB_TEMPLATES_DOMAIN, kb.templates, "template"); } catch { /* */ }
  // Asegura que los dominios existan aunque estén vacíos (para búsquedas sin error).
  try { ensureDomain(eng, KB_LIBRARY_DOMAIN); ensureDomain(eng, KB_TEMPLATES_DOMAIN); } catch { /* */ }
  try { eng.persist(); } catch { /* flat no persiste */ }
  return { projects: projects.length, documents, kb: kbDocs };
}

/** ¿La BBDD está vacía? (sin dominios, o ningún documento en ninguno). */
export function isEmpty(eng: NucleusEngine): boolean {
  const domains = eng.listDomains().domains ?? [];
  if (domains.length === 0) return true;
  for (const d of domains) {
    if ((eng.listDocuments(d.id, 0, 1).documents ?? []).length > 0) return false;
  }
  return true;
}
