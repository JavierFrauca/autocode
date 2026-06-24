import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { ingestRevision } from "../papers/ingest.js";
import { searchDocuments } from "../tools/knowledge.js";
import { getArchitecture } from "../architecture.js";
import { ensureMockupForScreen, isMockupStale, isScreenDoc, mockupPathFor } from "../agents/mockup.js";
import { nucleusDeleteDoc } from "../nucleus/client.js";
import { projectDomain } from "../nucleus/domains.js";
import { chat } from "../llm/client.js";
import { saveProjectDocument } from "../papers/save.js";
import type { AppConfig } from "@shared";

/** Quita vallas ```markdown … ``` si el modelo las añade. */
function stripMdFence(raw: string): string {
  const s = (raw ?? "").trim();
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (m?.[1] ?? s).trim();
}

/** Aplica con IA un cambio en lenguaje natural sobre la especificación (Markdown) de una pantalla. */
async function editSpecWithAi(cfg: AppConfig, spec: string, instruction: string): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content:
        "Eres un editor de especificaciones de pantalla en Markdown. Aplica EXACTAMENTE el cambio que " +
        "pide el usuario sobre la especificación dada, conservando el resto del contenido, el estilo y la " +
        "estructura. No añadas comentarios ni explicaciones. Devuelve SOLO el Markdown completo ya actualizado.",
    },
    {
      role: "user" as const,
      content:
        `Especificación actual:\n\n${spec}\n\nCambio a aplicar:\n"${instruction}"\n\n` +
        "Devuelve la especificación completa ya modificada (solo Markdown, sin vallas de código).",
    },
  ];
  const res = await chat(cfg, "chat", messages, { temperature: 0.2, maxTokens: 4000 }, "screen-modify");
  return stripMdFence(res.content);
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error("Project not found");
  return rows[0];
}

/** Recursive file tree of .md files in the project folder */
async function buildTree(rootPath: string, dir: string, rel = ""): Promise<any[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: any[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Ocultar carpetas internas del explorador de Documentos: build y cualquier `_*`
    // (_app = código generado, _plan, _historial…). Solo meten ruido para el usuario.
    if (e.isDirectory() && (e.name === "build" || e.name.startsWith("_"))) continue;
    if (e.name.startsWith(".")) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await buildTree(rootPath, path.join(dir, e.name), relPath);
      result.push({ type: "dir", name: e.name, path: relPath, children });
    } else if (e.name.endsWith(".md") && !e.name.endsWith(".fuente.md")) {
      // `*.fuente.md` = fuente cruda de un documento técnico: artefacto recuperable, no se lista (como las maquetas).
      result.push({ type: "file", name: e.name, path: relPath });
    }
  }
  return result;
}

export async function registerFilesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/projects/:id/files — file tree
  app.get("/api/projects/:id/files", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const tree = await buildTree(project.rootPath, project.rootPath);
    return { tree };
  });

  // GET /api/projects/:id/files/content?path=decisiones/ADR-001.md
  app.get("/api/projects/:id/files/content", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: "path required" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(project.rootPath, relPath);
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });
    try {
      const content = await fs.readFile(abs, "utf-8");
      return { path: relPath, content };
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }
  });

  // PUT /api/projects/:id/files — write file and re-ingest
  app.put("/api/projects/:id/files", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { path: string; content: string };
    if (!body?.path || body.content == null) return reply.code(400).send({ error: "path and content required" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(project.rootPath, body.path);
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body.content, "utf-8");

    // Re-ingest to Qdrant (fire-and-forget with error logging)
    ingestFile(id, project, body.path, body.content).catch((e) =>
      app.log.warn(e, `ingest failed for ${body.path}`)
    );

    // Auto-maqueta la 1ª vez: si es una pantalla con contenido real y aún no tiene boceto, lo
    // genera en segundo plano (force:false → no-op si ya existe o el spec es un stub).
    if (isScreenDoc(body.path)) {
      loadConfig()
        .then(async (cfg) => {
          const appType = (await getArchitecture(id))?.appType ?? "electron";
          return ensureMockupForScreen(cfg, id, body.path, { force: false, appType });
        })
        .catch((e) => app.log.warn(e, `auto-mockup failed for ${body.path}`));
    }

    return { ok: true, path: body.path };
  });

  // GET /api/projects/:id/screens/mockup?path=pantallas/x.md — boceto HTML de una pantalla
  app.get("/api/projects/:id/screens/mockup", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: "path required" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(project.rootPath, mockupPathFor(relPath));
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });
    try {
      const [html, st] = await Promise.all([fs.readFile(abs, "utf-8"), fs.stat(abs)]);
      const stale = await isMockupStale(project.rootPath, relPath);
      return { exists: true, html, stale, generatedAt: st.mtime.toISOString() };
    } catch {
      return { exists: false, html: null, stale: false, generatedAt: null };
    }
  });

  // POST /api/projects/:id/screens/mockup { path, instruction? } — (re)genera la maqueta (botón del
  // usuario). Con `instruction` ("modificar con IA") modifica el boceto actual según lo que pida.
  app.post("/api/projects/:id/screens/mockup", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath, instruction } = (req.body ?? {}) as { path?: string; instruction?: string };
    if (!relPath) return reply.code(400).send({ error: "path required" });
    if (!isScreenDoc(relPath)) return reply.code(400).send({ error: "no es una pantalla" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    const appType = (await getArchitecture(id))?.appType ?? "electron";
    const r = await ensureMockupForScreen(cfg, id, relPath, { force: true, appType, instruction });
    if (r.status !== "generated") {
      return reply.code(500).send({ error: "no se pudo generar la maqueta" });
    }
    const abs = path.resolve(project.rootPath, r.path!);
    const html = await fs.readFile(abs, "utf-8").catch(() => null);
    return { ok: true, html };
  });

  // POST /api/projects/:id/screens/modify { path, instruction } — "Modificar con IA" coherente: aplica
  // el cambio al SPEC (.md, fuente de verdad) y regenera la maqueta desde el spec ya actualizado.
  app.post("/api/projects/:id/screens/modify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath, instruction } = (req.body ?? {}) as { path?: string; instruction?: string };
    if (!relPath || !instruction?.trim()) return reply.code(400).send({ error: "path e instruction requeridos" });
    if (!isScreenDoc(relPath)) return reply.code(400).send({ error: "no es una pantalla" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(project.rootPath, relPath);
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });
    const spec = await fs.readFile(abs, "utf-8").catch(() => null);
    if (spec === null) return reply.code(404).send({ error: "spec no encontrado" });

    const cfg = await loadConfig();
    let newSpec: string;
    try {
      newSpec = await editSpecWithAi(cfg, spec, instruction.trim());
    } catch (e: any) {
      return reply.code(500).send({ error: `la IA no pudo editar la especificación: ${e?.message ?? e}` });
    }
    if (!newSpec.trim()) return reply.code(500).send({ error: "la IA devolvió una especificación vacía" });

    // Guarda el spec por el camino canónico (disco + tabla documents + revisión + reindex en Nucleus).
    await saveProjectDocument(cfg, id, { ruta: relPath, contenido: newSpec });
    // Regenera el boceto desde el spec ya actualizado.
    const appType = (await getArchitecture(id))?.appType ?? "electron";
    const r = await ensureMockupForScreen(cfg, id, relPath, { force: true, appType });
    const html = r.status === "generated"
      ? await fs.readFile(path.resolve(project.rootPath, r.path!), "utf-8").catch(() => null)
      : null;
    return { ok: true, spec: newSpec, html };
  });

  // GET /api/projects/:id/screens — todas las pantallas con su maqueta (para la galería viva).
  app.get("/api/projects/:id/screens", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const dir = path.join(project.rootPath, "pantallas");
    let names: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md") && !e.name.toLowerCase().endsWith(".fuente.md"))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return { screens: [] }; // aún no hay carpeta de pantallas
    }
    const screens = await Promise.all(names.map(async (name) => {
      const relPath = `pantallas/${name}`;
      const htmlAbs = path.resolve(project.rootPath, mockupPathFor(relPath));
      const html = await fs.readFile(htmlAbs, "utf-8").catch(() => null);
      const stale = html ? await isMockupStale(project.rootPath, relPath) : false;
      return {
        path: relPath,
        name: name.replace(/\.md$/i, "").replace(/-/g, " "),
        mockupExists: !!html,
        stale,
        html,
      };
    }));
    return { screens };
  });

  // POST /api/projects/:id/files/search — búsqueda semántica via Qdrant
  app.post("/api/projects/:id/files/search", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { query } = (req.body ?? {}) as { query?: string };
    if (!query?.trim()) return { ok: true, hits: [] };
    const result = await searchDocuments({ query, projectId: id, topK: 8 });
    return result;
  });

  // GET /api/projects/:id/files/revisions?path=... — historial de revisiones de un doc
  app.get("/api/projects/:id/files/revisions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: "path required" });

    const doc = await db()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.projectId, id), eq(schema.documents.path, relPath), isNull(schema.documents.deletedAt)))
      .limit(1);

    if (!doc[0]) return { revisions: [] };

    const revs = await db()
      .select({
        id: schema.documentRevisions.id,
        authorRole: schema.documentRevisions.authorRole,
        comment: schema.documentRevisions.comment,
        createdAt: schema.documentRevisions.createdAt,
        preview: schema.documentRevisions.body,
      })
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, doc[0].id))
      .orderBy(desc(schema.documentRevisions.createdAt))
      .limit(50);

    return { revisions: revs.map((r) => ({ ...r, preview: r.preview.slice(0, 180).replace(/\n/g, " ") })) };
  });

  // POST /api/projects/:id/files/restore — restaurar una revisión anterior
  app.post("/api/projects/:id/files/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath, revisionId } = (req.body ?? {}) as { path?: string; revisionId?: string };
    if (!relPath || !revisionId) return reply.code(400).send({ error: "path and revisionId required" });

    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });

    const abs = path.resolve(project.rootPath, relPath);
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });

    const rev = await db()
      .select({ body: schema.documentRevisions.body })
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.id, revisionId))
      .limit(1);

    if (!rev[0]) return reply.code(404).send({ error: "revision not found" });

    await fs.writeFile(abs, rev[0].body, "utf-8");
    ingestFile(id, project, relPath, rev[0].body).catch((e) =>
      app.log.warn(e, `ingest failed for ${relPath}`),
    );
    return { ok: true };
  });

  // DELETE /api/projects/:id/files?path=...
  app.delete("/api/projects/:id/files", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = req.query as { path?: string };
    if (!relPath) return reply.code(400).send({ error: "path required" });
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(project.rootPath, relPath);
    if (!abs.startsWith(project.rootPath)) return reply.code(400).send({ error: "invalid path" });

    try { await fs.unlink(abs); } catch {}

    // Remove from Qdrant and SQLite
    removeFile(id, project, relPath).catch((e) =>
      app.log.warn(e, `remove failed for ${relPath}`)
    );

    return { ok: true };
  });
}

async function ingestFile(
  projectId: string,
  project: { qdrantCollection: string; embeddingsDim: number },
  relPath: string,
  content: string,
): Promise<void> {
  const cfg = await loadConfig();
  const title = extractTitle(content, relPath);

  const existing = await db()
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, relPath)));

  let docId: string;
  if (existing[0]) {
    docId = existing[0].id;
    await db().update(schema.documents)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, docId));
  } else {
    docId = `doc_${ulid().toLowerCase()}`;
    await db().insert(schema.documents).values({
      id: docId, projectId, path: relPath, title, tags: [], status: "active",
    });
  }

  const revId = `rev_${ulid().toLowerCase()}`;
  await db().insert(schema.documentRevisions).values({
    id: revId, documentId: docId, projectId, body: content, authorRole: "user",
  });

  await ingestRevision(cfg, projectId, project.qdrantCollection, docId, revId, relPath, title, content);
}

async function removeFile(
  projectId: string,
  _project: { qdrantCollection: string },
  relPath: string,
): Promise<void> {
  const existing = await db()
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, relPath)));
  if (!existing[0]) return;

  const docId = existing[0].id;
  try { await nucleusDeleteDoc(projectDomain(projectId), relPath); } catch { /* best-effort */ }
  await db().update(schema.documents)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.documents.id, docId));
}

function extractTitle(content: string, fallbackPath: string): string {
  const m = content.match(/^#\s+(.+)$/m) || content.match(/^title:\s*(.+)$/mi);
  return (m?.[1] ?? path.basename(fallbackPath, ".md")).trim().slice(0, 200);
}
