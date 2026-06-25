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
import { isMockupStale, isScreenDoc, mockupPathFor } from "../agents/mockup.js";
import { nucleusDeleteDoc } from "../nucleus/client.js";
import { projectDomain } from "../nucleus/domains.js";
import { defineScreens } from "../agents/screen-planner.js";
import * as screens from "../screens/service.js";

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

    // Las PANTALLAS pasan SIEMPRE por el servicio único (frontmatter + registro + maqueta). El resto,
    // escritura genérica (disco + re-ingest).
    if (isScreenDoc(body.path)) {
      const cfg = await loadConfig();
      try { await screens.saveScreenSpec(cfg, id, body.path, body.content, { mockup: "auto" }); }
      catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
      return { ok: true, path: body.path };
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body.content, "utf-8");
    ingestFile(id, project, body.path, body.content).catch((e) =>
      app.log.warn(e, `ingest failed for ${body.path}`),
    );

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

  // Todas las rutas de pantallas pasan por el SERVICIO único (screens/service.ts): una sola forma de
  // crear/guardar/mover/borrar/regenerar (spec con frontmatter vía saveProjectDocument + maqueta).

  // POST /api/projects/:id/screens/mockup { path } — regenera la maqueta desde el spec actual.
  app.post("/api/projects/:id/screens/mockup", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = (req.body ?? {}) as { path?: string };
    if (!relPath || !isScreenDoc(relPath)) return reply.code(400).send({ error: "no es una pantalla" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      const r = await screens.regenerateMockup(cfg, id, relPath);
      return { ok: true, html: r.html };
    } catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
  });

  // POST /api/projects/:id/screens/modify { path, instruction } — "Modificar con IA" coherente (spec + maqueta).
  app.post("/api/projects/:id/screens/modify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath, instruction } = (req.body ?? {}) as { path?: string; instruction?: string };
    if (!relPath || !instruction?.trim() || !isScreenDoc(relPath)) return reply.code(400).send({ error: "path e instruction requeridos" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      const r = await screens.modifyScreenWithAi(cfg, id, relPath, instruction);
      return { ok: true, spec: r.spec, html: r.html };
    } catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
  });

  // GET /api/projects/:id/screens — todas las pantallas con su jerarquía y su maqueta.
  app.get("/api/projects/:id/screens", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    return screens.listScreens(id);
  });

  // POST /api/projects/:id/screens { name, kind?, parent? } — crea una pantalla (página o modal de otra).
  app.post("/api/projects/:id/screens", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string; kind?: "pagina" | "modal"; parent?: string | null };
    if (!body.name?.trim()) return reply.code(400).send({ error: "name requerido" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      const r = await screens.createScreen(cfg, id, { name: body.name, kind: body.kind, parent: body.parent });
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(409).send({ error: e?.message ?? String(e) }); }
  });

  // POST /api/projects/:id/screens/meta { path, kind?, parent?, order? } — mover/reordenar/convertir en modal.
  app.post("/api/projects/:id/screens/meta", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { path?: string; kind?: "pagina" | "modal"; parent?: string | null; order?: number };
    if (!body.path || !isScreenDoc(body.path)) return reply.code(400).send({ error: "pantalla inválida" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      await screens.setScreenMeta(cfg, id, body.path, {
        ...(body.kind !== undefined ? { kind: body.kind === "modal" ? "modal" : "pagina" } : {}),
        ...(body.parent !== undefined ? { parent: body.parent || null } : {}),
        ...(body.order !== undefined ? { order: Number(body.order) } : {}),
      });
      return { ok: true };
    } catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
  });

  // DELETE /api/projects/:id/screens?path=pantallas/x.md — borra spec + maqueta (vía servicio).
  app.delete("/api/projects/:id/screens", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path: relPath } = req.query as { path?: string };
    if (!relPath || !isScreenDoc(relPath)) return reply.code(400).send({ error: "pantalla inválida" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    await screens.deleteScreen(cfg, id, relPath);
    return { ok: true };
  });

  // GET /api/projects/:id/screens/map — árbol del MAPA (fuente de la estructura) + estado de cada nodo.
  app.get("/api/projects/:id/screens/map", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    return screens.mapWithStatus(id);
  });

  // POST /api/projects/:id/screens/map { tree } — guarda el árbol editado (escribe el mapa + materializa,
  // creando las nuevas y borrando las huérfanas que ya no están en el árbol).
  app.post("/api/projects/:id/screens/map", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tree } = (req.body ?? {}) as { tree?: any[] };
    if (!Array.isArray(tree)) return reply.code(400).send({ error: "tree requerido" });
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      const r = await screens.saveMap(cfg, id, tree as any);
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
  });

  // POST /api/projects/:id/screens/materialize — vuelve a sincronizar las pantallas con el mapa.
  app.post("/api/projects/:id/screens/materialize", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await getProject(id).catch(() => null))) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    try {
      const r = await screens.materializeMap(cfg, id, { deleteOrphans: false });
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(500).send({ error: e?.message ?? String(e) }); }
  });

  // POST /api/projects/:id/screens/define — agente que enumera TODAS las pantallas (con jerarquía) y
  // crea sus specs + el MAPA; las maquetas se generan en segundo plano.
  app.post("/api/projects/:id/screens/define", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await getProject(id).catch(() => null);
    if (!project) return reply.code(404).send({ error: "not found" });
    const cfg = await loadConfig();
    const appType = (await getArchitecture(id))?.appType ?? "electron";
    try {
      const r = await defineScreens(cfg, id, appType);
      return { ok: true, ...r };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message ?? String(e) });
    }
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
