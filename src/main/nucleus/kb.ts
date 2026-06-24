import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { nucleusIngestDoc } from "./client.js";
import { KB_LIBRARY_DOMAIN, KB_TEMPLATES_DOMAIN } from "./domains.js";

/**
 * Catálogos transversales (library/templates) en Nucleus. El indexado masivo lo hace el indexador
 * diferido; aquí va el reindexado de UN fichero tras editarlo en la UI (lo llama routes/library.ts).
 */
function resolveStaticDir(name: string): string {
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  return path.resolve(__dirname, "..", "..", name);
}

export function kbDirs(): { library: string; templates: string } {
  return { library: resolveStaticDir("library"), templates: resolveStaticDir("templates") };
}

export async function reindexKbFile(source: "library" | "templates", relPathRaw: string): Promise<void> {
  const rel = relPathRaw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel.endsWith(".md")) return;
  const dirs = kbDirs();
  const dir = source === "library" ? dirs.library : dirs.templates;
  const abs = path.normalize(path.join(dir, rel));
  if (abs !== path.normalize(dir) && !abs.startsWith(path.normalize(dir) + path.sep)) return; // no salir del catálogo
  let text: string;
  try { text = await fs.readFile(abs, "utf-8"); } catch { return; }
  const domain = source === "library" ? KB_LIBRARY_DOMAIN : KB_TEMPLATES_DOMAIN;
  const collectionType = source === "library" ? "library" : "template";
  await nucleusIngestDoc(domain, {
    source: rel,
    title: rel,
    text,
    metadata: { collection_type: collectionType, file_path: rel },
  });
}
