import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { z } from "zod";
import { EMBEDDINGS_DIM } from "@shared";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { ensureDir } from "../papers/fs.js";
import { QdrantClient } from "../qdrant/client.js";

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

/**
 * Estado de la tarjeta de proyecto en "Mis proyectos". No es un porcentaje inventado:
 * refleja la fase real del ciclo de vida y la UI lo traduce a barra + etiqueta + color.
 *  - empty: sin documentos todavía
 *  - defining: documentando, aún no se ha generado
 *  - generating / checking: ejecución en curso (construcción / validación)
 *  - built: hay una app compilada en verde en disco
 *  - needs_input: el ejecutor pidió ayuda a la persona
 *  - failed: el último intento falló
 */
export type ProjectStatus =
  | "empty"
  | "defining"
  | "generating"
  | "checking"
  | "built"
  | "needs_input"
  | "failed";

function deriveStatus(
  docs: number,
  latest: { status: string; currentPhase: string | null } | undefined,
  built: boolean,
): ProjectStatus {
  if (latest) {
    if (latest.status === "running") {
      return latest.currentPhase === "Validación" ? "checking" : "generating";
    }
    if (latest.status === "needs_input") return "needs_input";
    if (latest.status === "failed") return "failed";
    // "done" / "cancelled" caen abajo: si hubo verde alguna vez, la app sigue en disco.
  }
  if (built) return "built";
  if (docs > 0) return "defining";
  return "empty";
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async () => {
    const rows = await db()
      .select()
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt));

    const docCounts = await db()
      .select({
        projectId: schema.documents.projectId,
        n: sql<number>`count(*)`.as("n"),
      })
      .from(schema.documents)
      .where(isNull(schema.documents.deletedAt))
      .groupBy(schema.documents.projectId);
    const countMap = new Map(docCounts.map((c) => [c.projectId, Number(c.n)]));

    // Estado de construcción por proyecto, derivado de las ejecuciones del ejecutor.
    // Recorremos en orden descendente: la primera fila de cada proyecto es su última
    // ejecución (estado vivo); además marcamos si ALGUNA llegó a "done" — eso significa
    // que hay una app compilada en verde en disco aunque el último intento se cancelara.
    const execRows = await db()
      .select({
        projectId: schema.executions.projectId,
        status: schema.executions.status,
        currentPhase: schema.executions.currentPhase,
      })
      .from(schema.executions)
      .orderBy(desc(schema.executions.createdAt));
    const latestExec = new Map<string, { status: string; currentPhase: string | null }>();
    const hasBuild = new Set<string>();
    for (const e of execRows) {
      if (!latestExec.has(e.projectId)) {
        latestExec.set(e.projectId, { status: e.status, currentPhase: e.currentPhase });
      }
      if (e.status === "done") hasBuild.add(e.projectId);
    }

    return rows.map((p) => {
      const documentsCount = countMap.get(p.id) ?? 0;
      return {
        ...p,
        documentsCount,
        status: deriveStatus(documentsCount, latestExec.get(p.id), hasBuild.has(p.id)),
      };
    });
  });

  app.post("/api/projects", async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cfg = await loadConfig();
    if (!cfg.projectsRoot) return reply.code(400).send({ error: "projectsRoot no configurado" });

    const id = `proj_${ulid().toLowerCase()}`;
    const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const rootPath = path.join(cfg.projectsRoot, slug || id);
    await ensureDir(rootPath);
    // Create standard project folders
    for (const folder of ["decisiones", "reglas", "pantallas", "patrones", "_historial", "_plan"]) {
      await ensureDir(path.join(rootPath, folder));
    }

    const collection = `project_${id.replace(/^proj_/, "")}`;
    const qdrant = new QdrantClient(cfg.qdrantUrl);
    await qdrant.ensureCollection(collection, EMBEDDINGS_DIM);

    await db().insert(schema.projects).values({
      id,
      name: parsed.data.name,
      rootPath,
      description: parsed.data.description ?? null,
      qdrantCollection: collection,
      embeddingsDim: EMBEDDINGS_DIM,
    });

    return { id, name: parsed.data.name, rootPath };
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, id));
    const p = rows[0];
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.delete("/api/projects/:id", async (req) => {
    const id = (req.params as any).id as string;
    await db()
      .update(schema.projects)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)));
    return { ok: true };
  });
}
