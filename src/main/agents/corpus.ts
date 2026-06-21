import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { isDocPath } from "../papers/ingest.js";

/**
 * Carga los papers vigentes de un proyecto como un único corpus de texto para
 * alimentar a los agentes (coder, qa, planner). Fuente de verdad: la última
 * revisión de cada documento activo en SQLite. Si no hay nada en BD, cae a leer
 * los .md del rootPath.
 */
async function mediaManifest(rootPath: string): Promise<string> {
  const dir = path.join(rootPath, "media");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => `  - media/${e.name}`);
    if (files.length === 0) return "";
    return [
      "### Recursos multimedia del proyecto (carpeta media/)",
      "El proyecto incluye las siguientes imágenes que PUEDES y DEBES usar en el código generado.",
      "Referencíalas con la ruta relativa exacta (p.ej. `./media/logo.png` o `/media/logo.png`",
      "según el tipo de app). Son heterogéneas en tamaño y formato — gestiónalas con CSS flexible",
      "(object-fit, max-width, etc.) para que encajen bien en la interfaz.",
      "",
      files.join("\n"),
    ].join("\n");
  } catch {
    return "";
  }
}

export async function loadProjectCorpus(rootPath: string, projectId: string): Promise<string> {
  const docs = await db()
    .select({
      id: schema.documents.id,
      path: schema.documents.path,
      title: schema.documents.title,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), isNull(schema.documents.deletedAt)));

  const parts: string[] = [];
  for (const d of docs) {
    // Misma allowlist que la indexación: solo documentos de negocio (DOC_DIRS). Nunca código
    // generado (_app), dependencias (node_modules), historial, planes, etc.
    if (!isDocPath(d.path)) continue;
    const rev = (
      await db()
        .select({ body: schema.documentRevisions.body })
        .from(schema.documentRevisions)
        .where(eq(schema.documentRevisions.documentId, d.id))
        .orderBy(desc(schema.documentRevisions.createdAt))
        .limit(1)
    )[0];
    if (rev?.body?.trim()) {
      parts.push(`### ${d.path} — ${d.title}\n${rev.body}`);
    }
  }

  const media = await mediaManifest(rootPath);

  if (parts.length > 0) {
    const corpus = parts.join("\n\n---\n\n");
    return capCorpus(media ? `${corpus}\n\n---\n\n${media}` : corpus);
  }

  // Fallback: leer .md del filesystem
  const fsParts = await readMdTree(rootPath);
  const base = fsParts.length > 0 ? fsParts.join("\n\n---\n\n") : "(sin documentos todavía)";
  return capCorpus(media ? `${base}\n\n---\n\n${media}` : base);
}

/** Red de seguridad: nunca devolver un corpus monstruoso que reviente el contexto del modelo. */
const MAX_CORPUS_CHARS = 280_000; // ~70K tokens
function capCorpus(s: string): string {
  if (s.length <= MAX_CORPUS_CHARS) return s;
  return s.slice(0, MAX_CORPUS_CHARS) + "\n\n[... documentación recortada por tamaño ...]";
}

async function readMdTree(dir: string, rel = "", depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const out: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(...(await readMdTree(abs, relPath, depth + 1)));
      } else if (e.name.endsWith(".md")) {
        try {
          out.push(`### ${relPath}\n${await fs.readFile(abs, "utf-8")}`);
        } catch {}
      }
    }
  } catch {}
  return out;
}
