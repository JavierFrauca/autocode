import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { db, schema } from "../db/client.js";
import { enqueue } from "../agents/runner.js";
import { ensureArchitecture } from "../architecture.js";

/**
 * Convierte un timestamp a epoch ms, tolerando los DOS formatos que conviven en la BD: ISO de JS
 * ("2026-06-18T11:00:00.000Z") y el de SQLite `datetime('now')` ("2026-06-18 11:00:00", UTC, sin T/Z).
 * Compararlos como CADENAS estaba MAL (la 'T' del ISO siempre ordena después del espacio → caducado
 * eterno). Devuelve 0 si está vacío o no parsea.
 */
function toEpoch(ts: string | null | undefined): number {
  if (!ts) return 0;
  let s = ts.trim();
  if (!s.includes("T")) s = s.replace(" ", "T"); // SQLite "fecha hora" → "fechaThora"
  if (!/[Z+]/.test(s.slice(10))) s += "Z";       // sin zona → UTC (datetime('now') es UTC)
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Epoch ms del último cambio en la documentación del proyecto (papers: ADR, reglas, pantallas…). El
 * historial de conversación NO cuenta (vive en _historial/, no en la tabla documents). Considera tanto
 * altas/ediciones (updatedAt) como bajas (deletedAt) → "cualquier cambio documentado".
 */
async function lastDocChange(projectId: string): Promise<number> {
  const rows = await db()
    .select({ updatedAt: schema.documents.updatedAt, deletedAt: schema.documents.deletedAt })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, projectId));
  let max = 0;
  for (const r of rows) max = Math.max(max, toEpoch(r.updatedAt), toEpoch(r.deletedAt));
  return max;
}

export async function registerPlanRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/projects/:id/plan — último plan + si está CADUCADO (la doc cambió desde que se hizo).
  app.get("/api/projects/:id/plan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db()
      .select()
      .from(schema.sprintPlans)
      .where(eq(schema.sprintPlans.projectId, id))
      .orderBy(desc(schema.sprintPlans.createdAt))
      .limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "no plan yet" });
    const plan = rows[0];
    // Plan caducado = la documentación cambió DESPUÉS de generarse/actualizarse el plan. Se compara con
    // la marca más reciente del plan (updatedAt si es posterior a createdAt). Si caducó, la UI ofrece
    // "Actualizar plan" antes de construir; no se re-planifica solo (decisión: preguntar antes).
    const docEpoch = await lastDocChange(id);
    const planEpoch = Math.max(toEpoch(plan.createdAt), toEpoch(plan.updatedAt));
    // datetime('now') tiene precisión de SEGUNDOS; comparamos a nivel de segundo para no marcar caducado
    // por milisegundos de diferencia dentro de la misma operación (regenerar plan tras editar docs).
    const stale = Math.floor(docEpoch / 1000) > Math.floor(planEpoch / 1000);
    return { ...plan, stale, lastDocChange: docEpoch ? new Date(docEpoch).toISOString() : null };
  });

  // POST /api/projects/:id/plan/generate — enqueue planner agent
  // El tipo de app se deriva del ADR de arquitectura (fuente de verdad), no de la UI.
  app.post("/api/projects/:id/plan/generate", async (req) => {
    const { id } = req.params as { id: string };
    const arch = await ensureArchitecture(id);
    const appType = arch.appType;
    const runId = await enqueue({
      projectId: id,
      agentType: "planner",
      triggeredBy: "user",
      input: { appType },
    });
    return { runId };
  });

  // PUT /api/projects/:id/plan — save/update plan
  app.put("/api/projects/:id/plan", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { planJson: any; planId?: string };
    if (body.planId) {
      await db().update(schema.sprintPlans)
        .set({ planJson: body.planJson, updatedAt: new Date().toISOString() })
        .where(eq(schema.sprintPlans.id, body.planId));
      return { ok: true };
    }
    const planId = `plan_${ulid().toLowerCase()}`;
    await db().insert(schema.sprintPlans).values({
      id: planId, projectId: id, planJson: body.planJson,
    });
    return { ok: true, planId };
  });
}
