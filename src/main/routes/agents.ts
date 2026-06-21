import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { applyRun, cancel, enqueue } from "../agents/runner.js";

// La construcción de apps la hace AHORA el agente builder único (vía el executor), no el viejo
// pipeline coder→qa→fixer. Por eso "coder"/"qa" ya no se pueden disparar a mano: dejarlo lanzaría
// la orquestación rígida retirada. Estos son los agentes que SÍ tienen sentido invocar sueltos.
const ALLOWED_TYPES = ["documenter", "planner", "reindexer"];

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:projectId/agent-runs", async (req) => {
    const { projectId } = req.params as { projectId: string };
    return db()
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.projectId, projectId))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(100);
  });

  app.get("/api/agent-runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id));
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    return rows[0];
  });

  app.post("/api/agent-runs/:id/apply", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as { apply?: boolean }) ?? {};
    const ok = await applyRun(id, body.apply ?? true);
    if (!ok) return reply.code(409).send({ error: "cannot apply" });
    return { ok: true };
  });

  app.post("/api/agent-runs/:id/cancel", async (req) => {
    const { id } = req.params as { id: string };
    const ok = await cancel(id);
    return { ok };
  });

  app.delete("/api/agent-runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db().select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    if (rows[0].status === "pending" || rows[0].status === "running") {
      return reply.code(409).send({ error: "cannot delete an active run" });
    }
    await db().delete(schema.agentRuns).where(eq(schema.agentRuns.id, id));
    return { ok: true };
  });

  app.post("/api/projects/:projectId/agents/:type", async (req, reply) => {
    const { projectId, type } = req.params as { projectId: string; type: string };
    if (!ALLOWED_TYPES.includes(type)) {
      return reply.code(400).send({ error: `Unknown agent type: ${type}` });
    }
    const id = await enqueue({
      projectId,
      agentType: type as any,
      triggeredBy: "user",
      input: (req.body as any) ?? {},
    });
    return { runId: id };
  });
}
