import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico"]);
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

async function getRoot(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ rootPath: schema.projects.rootPath })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.rootPath ?? null;
}

function mediaDir(rootPath: string) {
  return path.join(rootPath, "media");
}

function safeName(raw: string): string {
  return path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // GET  /api/projects/:id/media  — lista todos los ficheros
  app.get("/api/projects/:id/media", async (req, reply) => {
    const { id } = req.params as { id: string };
    const root = await getRoot(id);
    if (!root) return reply.code(404).send({ error: "not found" });
    const dir = mediaDir(root);
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && !e.name.startsWith(".") && ALLOWED_EXT.has(path.extname(e.name).toLowerCase()))
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
          return {
            name: e.name,
            size: stat?.size ?? 0,
            url: `/api/projects/${id}/media/${encodeURIComponent(e.name)}`,
            projectPath: `media/${e.name}`,
          };
        }),
    );
    return { files };
  });

  // GET  /api/projects/:id/media/:filename  — sirve la imagen
  app.get("/api/projects/:id/media/:filename", async (req, reply) => {
    const { id, filename } = req.params as { id: string; filename: string };
    const root = await getRoot(id);
    if (!root) return reply.code(404).send({ error: "not found" });
    const dir = mediaDir(root);
    const abs = path.resolve(dir, filename);
    if (!abs.startsWith(dir + path.sep) && abs !== dir) return reply.code(400).send({ error: "invalid path" });
    try {
      const data = await fs.readFile(abs);
      const mime = EXT_MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
      reply.header("content-type", mime);
      reply.header("cache-control", "public, max-age=3600");
      return reply.send(data);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  // POST /api/projects/:id/media  — sube una imagen (multipart)
  app.post("/api/projects/:id/media", async (req, reply) => {
    const { id } = req.params as { id: string };
    const root = await getRoot(id);
    if (!root) return reply.code(404).send({ error: "not found" });
    const dir = mediaDir(root);
    await fs.mkdir(dir, { recursive: true });

    const data = await req.file({ limits: { fileSize: MAX_SIZE_BYTES } });
    if (!data) return reply.code(400).send({ error: "no file received" });

    const ext = path.extname(data.filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return reply.code(400).send({ error: `tipo no permitido: ${ext}` });

    const filename = safeName(data.filename);
    const abs = path.join(dir, filename);
    await fs.writeFile(abs, await data.toBuffer());
    const stat = await fs.stat(abs);

    return {
      ok: true,
      name: filename,
      size: stat.size,
      url: `/api/projects/${id}/media/${encodeURIComponent(filename)}`,
      projectPath: `media/${filename}`,
    };
  });

  // DELETE /api/projects/:id/media/:filename
  app.delete("/api/projects/:id/media/:filename", async (req, reply) => {
    const { id, filename } = req.params as { id: string; filename: string };
    const root = await getRoot(id);
    if (!root) return reply.code(404).send({ error: "not found" });
    const dir = mediaDir(root);
    const abs = path.resolve(dir, filename);
    if (!abs.startsWith(dir + path.sep) && abs !== dir) return reply.code(400).send({ error: "invalid path" });
    try { await fs.unlink(abs); } catch {}
    return { ok: true };
  });
}
