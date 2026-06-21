import { desc, eq, notInArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { cancel, cancelAll } from "../agents/runner.js";
import { cancelAllCalls, cancelCall, getActivity, getCalls } from "../llm/activity.js";

/**
 * Visor global de la actividad LiteLLM. Fase 1: muestra la cola de agentes (`agent_runs`,
 * que es el grueso de las llamadas) con modelo/estado/fuente, y permite cancelar uno o toda
 * la cola. (Chat/embeddings y el aborto real de la petición HTTP quedan para una fase 2.)
 */
const ACTIVE = new Set(["pending", "running"]);

export async function registerLlmRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/llm/queue", async () => {
    const rows = await db()
      .select({
        id: schema.agentRuns.id,
        projectId: schema.agentRuns.projectId,
        projectName: schema.projects.name,
        agentType: schema.agentRuns.agentType,
        modelName: schema.agentRuns.modelName,
        modelRole: schema.agentRuns.modelRole,
        status: schema.agentRuns.status,
        triggeredBy: schema.agentRuns.triggeredBy,
        tokensIn: schema.agentRuns.tokensIn,
        tokensOut: schema.agentRuns.tokensOut,
        durationMs: schema.agentRuns.durationMs,
        errorMessage: schema.agentRuns.errorMessage,
        createdAt: schema.agentRuns.createdAt,
        finishedAt: schema.agentRuns.finishedAt,
      })
      .from(schema.agentRuns)
      .leftJoin(schema.projects, eq(schema.agentRuns.projectId, schema.projects.id))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(80);

    // Llamadas que NO son de agentes (chat, embeddings, títulos…) — no están en agent_runs.
    // Se quita `input` de la lista (puede ser grande): solo viaja en `current` para el desplegable.
    const otherCalls = getCalls().filter((c) => !c.agentRunId).slice(0, 30).map(({ input, ...rest }) => rest);
    const activeCount =
      rows.filter((r) => ACTIVE.has(r.status)).length + otherCalls.filter((c) => c.status === "running").length;
    // `current` SÍ conserva `input` → es lo que el panel despliega como "lo que entra" en vivo.
    return { runs: rows, otherCalls, activeCount, current: getActivity().current };
  });

  app.post("/api/llm/cancel/:id", async (req) => {
    const { id } = req.params as { id: string };
    // Un id puede ser de una llamada suelta (chat/embeddings, call_…) o de un run de agente.
    if (cancelCall(id)) return { ok: true };
    return { ok: await cancel(id) };
  });

  app.post("/api/llm/cancel-all", async () => {
    const calls = cancelAllCalls();
    const runs = await cancelAll();
    return { cancelled: runs + calls };
  });

  // DELETE /api/llm/history — elimina todos los runs no activos del visor
  app.delete("/api/llm/history", async () => {
    await db()
      .delete(schema.agentRuns)
      .where(notInArray(schema.agentRuns.status, ["pending", "running"]));
    return { ok: true };
  });
}
