import { watch } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { loadConfig } from "./config.js";
import { ingestRevision, isDocPath } from "./papers/ingest.js";
import { nucleusDeleteDoc } from "./nucleus/client.js";
import { projectDomain } from "./nucleus/domains.js";
import { ulid } from "ulid";

const DEBOUNCE_MS = 800;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function debounce(key: string, fn: () => void): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(key, setTimeout(() => { pending.delete(key); fn(); }, DEBOUNCE_MS));
}

async function getActiveProjects(): Promise<{ id: string; rootPath: string; qdrantCollection: string }[]> {
  return db().select({
    id: schema.projects.id,
    rootPath: schema.projects.rootPath,
    qdrantCollection: schema.projects.qdrantCollection,
  }).from(schema.projects).where(isNull(schema.projects.deletedAt));
}

async function handleChange(event: string, filePath: string, project: { id: string; rootPath: string; qdrantCollection: string }): Promise<void> {
  if (!filePath.endsWith(".md")) return;
  const relPath = path.relative(project.rootPath, filePath).replace(/\\/g, "/");
  // Regla en POSITIVO: solo se indexan documentos de las carpetas permitidas (DOC_DIRS). Todo lo
  // demás —`_app/` (incl. node_modules tras `npm install`), `planes/`, `media/`, etc.— se ignora.
  if (!isDocPath(relPath)) return;

  try {
    const cfg = await loadConfig();
    const stat = await fs.stat(filePath).catch(() => null);

    if (!stat || event === "rename" && !stat) {
      // File deleted
      await removeFile(project.id, relPath);
      return;
    }

    const content = await fs.readFile(filePath, "utf-8").catch(() => null);
    if (!content) return;

    const title = extractTitle(content, relPath);
    const existing = await db().select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, project.id), eq(schema.documents.path, relPath)));

    let docId: string;
    if (existing[0]) {
      docId = existing[0].id;
      await db().update(schema.documents)
        .set({ title, updatedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, docId));
    } else {
      docId = `doc_${ulid().toLowerCase()}`;
      await db().insert(schema.documents).values({
        id: docId, projectId: project.id, path: relPath, title, tags: [], status: "active",
      });
    }

    const revId = `rev_${ulid().toLowerCase()}`;
    await db().insert(schema.documentRevisions).values({
      id: revId, documentId: docId, projectId: project.id, body: content, authorRole: "user",
    });

    await ingestRevision(cfg, project.id, project.qdrantCollection, docId, revId, relPath, title, content);
    console.log(`[watcher] re-indexed: ${relPath}`);
  } catch (e) {
    console.error("[watcher] error processing", relPath, e);
  }
}

async function removeFile(projectId: string, relPath: string): Promise<void> {
  const existing = await db().select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, relPath)));
  if (!existing[0]) return;
  const docId = existing[0].id;
  try { await nucleusDeleteDoc(projectDomain(projectId), relPath); } catch { /* best-effort */ }
  await db().update(schema.documents)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.documents.id, docId));
  console.log(`[watcher] removido del índice: ${relPath}`);
}

function extractTitle(content: string, fallbackPath: string): string {
  const m = content.match(/^#\s+(.+)$/m) || content.match(/^title:\s*(.+)$/mi);
  return (m?.[1] ?? path.basename(fallbackPath, ".md")).trim().slice(0, 200);
}

export async function startWatcher(log: any): Promise<void> {
  const projects = await getActiveProjects();
  if (projects.length === 0) return;

  for (const project of projects) {
    try {
      const watcher = watch(project.rootPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const absPath = path.join(project.rootPath, filename);
        debounce(absPath, () => handleChange(event, absPath, project).catch((e) => log.warn(e, "watcher handle error")));
      });
      watcher.on("error", (e) => log.warn(e, `[watcher] error on ${project.rootPath}`));
      log.info(`[watcher] watching ${project.rootPath}`);
    } catch (e) {
      log.warn(e, `[watcher] could not watch ${project.rootPath}`);
    }
  }
}
