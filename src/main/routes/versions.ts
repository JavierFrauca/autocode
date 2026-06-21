import path from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { listVersions, restoreVersion } from "../git/repo.js";

/**
 * "Versiones que funcionan" — la máquina del tiempo del proyecto, expuesta sin jerga git.
 * Cada versión es un estado que pasó el QA en verde.
 */
export async function registerVersionRoutes(app: FastifyInstance): Promise<void> {
  // El historial git vive en _app/ (el código generado), no en rootPath: los papers
  // tienen su propia historia en SQLite y versionarlos en git sería incoherente.
  async function projectDir(projectId: string): Promise<string | null> {
    const rows = await db()
      .select({ rootPath: schema.projects.rootPath })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    const root = rows[0]?.rootPath;
    return root ? path.join(root, "_app") : null;
  }

  app.get("/api/projects/:projectId/versions", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const dir = await projectDir(projectId);
    if (!dir) return reply.code(404).send({ error: "proyecto no encontrado" });
    const versions = await listVersions(dir);
    // Solo exponemos lo que el usuario necesita: id, fecha y etiqueta legible.
    return versions.map((v) => ({ id: v.hash, date: v.isoDate, label: v.subject }));
  });

  const RevertSchema = z.object({ versionId: z.string().min(7) });
  app.post("/api/projects/:projectId/revert", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = RevertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const dir = await projectDir(projectId);
    if (!dir) return reply.code(404).send({ error: "proyecto no encontrado" });
    const r = await restoreVersion(dir, parsed.data.versionId);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ok: true };
  });
}
