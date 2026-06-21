import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { app } from "electron";
import { reindexKbFile } from "../qdrant/collections.js";
import { log } from "../log.js";

type Source = "library" | "templates";

function resolveRoot(source: Source): string {
  if (app.isPackaged) return path.join(process.resourcesPath, source);
  return path.resolve(__dirname, "../../" + source);
}

async function buildTree(dir: string, rel = ""): Promise<any[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return [];
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const nodes: any[] = [];
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await buildTree(path.join(dir, e.name), relPath);
      if (children.length) nodes.push({ type: "dir", name: e.name, path: relPath, children });
    } else if (e.name.endsWith(".md")) {
      nodes.push({ type: "file", name: e.name, path: relPath });
    }
  }
  return nodes;
}

function guardPath(root: string, filePath: string): string | null {
  // Normalize both to avoid mixed separator issues on Windows
  const normalRoot = path.normalize(root);
  const abs = path.normalize(path.join(normalRoot, filePath));
  return abs.startsWith(normalRoot + path.sep) || abs === normalRoot ? abs : null;
}

export async function registerLibraryRoutes(app_: FastifyInstance): Promise<void> {
  app_.get("/api/library/tree", async (req) => {
    const source: Source = (req.query as any).source === "templates" ? "templates" : "library";
    return { source, tree: await buildTree(resolveRoot(source)) };
  });

  app_.get("/api/library/content", async (req, reply) => {
    const { source, path: filePath } = req.query as any;
    if (!filePath) return reply.code(400).send({ error: "path required" });
    const src: Source = source === "templates" ? "templates" : "library";
    const abs = guardPath(resolveRoot(src), filePath);
    if (!abs) return reply.code(400).send({ error: "invalid path" });
    try {
      return { content: await fs.readFile(abs, "utf8") };
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app_.put("/api/library/content", async (req, reply) => {
    const { source, path: filePath, content } = (req.body as any) ?? {};
    if (!filePath || content == null) return reply.code(400).send({ error: "path and content required" });
    const src: Source = source === "templates" ? "templates" : "library";
    const abs = guardPath(resolveRoot(src), filePath);
    if (!abs) return reply.code(400).send({ error: "invalid path" });
    await fs.writeFile(abs, content, "utf8");
    // Reindexa en segundo plano: sin esto, el RAG (buscar_biblioteca) seguiría sirviendo el chunk
    // viejo hasta el próximo arranque. Best-effort: no bloquea la respuesta ni rompe el guardado si
    // los embeddings o Qdrant no están disponibles.
    void reindexKbFile(src, filePath).catch((e) =>
      log.warn("library", "no se pudo reindexar el fichero editado", { err: e, source: src, path: filePath }),
    );
    return { ok: true };
  });
}
