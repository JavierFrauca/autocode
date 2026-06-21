import { existsSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { cancel, enqueue } from "../agents/runner.js";
import { PHASES } from "../agents/executor.js";

/**
 * Ejecución del plan: lanzar el ejecutor y consultar su estado (fases + pasos), para el
 * túnel de progreso. La UI sondea GET y, como todo vive en BD, sobrevive a la navegación.
 */
export async function registerExecutionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/projects/:id/execute", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { feedback?: unknown; fromScratch?: unknown };
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() || undefined : undefined;
    const fromScratch = body.fromScratch === true;
    const runId = await enqueue({
      projectId: id,
      agentType: "executor",
      triggeredBy: "user",
      input: { feedback, fromScratch },
    });
    return { runId };
  });

  // "He validado la app": el usuario da la versión por válida → se reconcilia la documentación con
  // lo que el código hace de verdad (papers, reglas, README). feedback = notas opcionales del usuario.
  app.post("/api/projects/:id/validate-version", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { feedback?: unknown };
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() || undefined : undefined;
    // El "OK" del usuario dispara DOS cosas (escriben ficheros distintos → pueden ir en paralelo):
    // (1) escribir las PRUEBAS de aceptación que codifican lo validado; (2) reconciliar la doc con el código.
    const testsRunId = await enqueue({
      projectId: id, agentType: "executor", triggeredBy: "user", input: { writeTests: true },
    });
    const runId = await enqueue({
      projectId: id, agentType: "reconciler", triggeredBy: "user", input: { feedback },
    });
    return { runId, testsRunId };
  });

  // "Crear las pruebas ahora" (voluntario, ANTES de validar): escribe las pruebas de aceptación sin
  // esperar al "OK" ni reconciliar la doc. Requiere que la app ya esté construida.
  app.post("/api/projects/:id/write-tests", async (req) => {
    const { id } = req.params as { id: string };
    const runId = await enqueue({
      projectId: id, agentType: "executor", triggeredBy: "user", input: { writeTests: true },
    });
    return { runId };
  });

  // Cancelar la construcción en curso: aborta el run del executor y marca la ejecución cancelada.
  app.post("/api/projects/:id/execute/cancel", async (req) => {
    const { id } = req.params as { id: string };
    const run = (
      await db()
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(and(
          eq(schema.agentRuns.projectId, id),
          eq(schema.agentRuns.agentType, "executor"),
          inArray(schema.agentRuns.status, ["pending", "running"]),
        ))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(1)
    )[0];
    if (run) await cancel(run.id); // aborta la llamada LLM en vuelo y marca el run cancelado

    const ex = (
      await db()
        .select({ id: schema.executions.id })
        .from(schema.executions)
        .where(and(eq(schema.executions.projectId, id), eq(schema.executions.status, "running")))
        .orderBy(desc(schema.executions.createdAt))
        .limit(1)
    )[0];
    if (ex) {
      await db().update(schema.executions)
        .set({ status: "cancelled", error: "Cancelado por el usuario", finishedAt: new Date().toISOString() })
        .where(eq(schema.executions.id, ex.id));
    }
    return { ok: true };
  });

  // Abre la carpeta de la app generada (`_app/`) en el explorador del sistema.
  app.post("/api/projects/:id/open-folder", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db()
      .select({ rootPath: schema.projects.rootPath })
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    const root = rows[0]?.rootPath;
    if (!root) return reply.code(404).send({ error: "proyecto no encontrado" });
    const appDir = path.join(root, "_app");
    const target = existsSync(appDir) ? appDir : root;
    const { shell } = await import("electron");
    const errMsg = await shell.openPath(target); // "" si ok; mensaje si falla
    if (errMsg) return reply.code(500).send({ error: errMsg });
    return { ok: true, path: target };
  });

  // ── DISTRIBUCIÓN ──────────────────────────────────────────────────────────────────────────────
  // Preparar la app de escritorio para repartirla: genera un INSTALADOR (.exe) que el usuario final
  // instala con doble clic. Bajo demanda (es lento: electron-builder descarga ~100MB la 1ª vez).

  // Lanza el empaquetado. Si ya hay uno en curso, devuelve ese mismo run (no duplica).
  app.post("/api/projects/:id/package", async (req) => {
    const { id } = req.params as { id: string };
    const existing = (
      await db()
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(and(
          eq(schema.agentRuns.projectId, id),
          eq(schema.agentRuns.agentType, "packager"),
          inArray(schema.agentRuns.status, ["pending", "running"]),
        ))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(1)
    )[0];
    if (existing) return { runId: existing.id, alreadyRunning: true };
    const runId = await enqueue({ projectId: id, agentType: "packager", triggeredBy: "user", input: {} });
    return { runId };
  });

  // Estado del último empaquetado (la UI lo sondea). state: none|running|done|failed.
  app.get("/api/projects/:id/package", async (req) => {
    const { id } = req.params as { id: string };
    const run = (
      await db()
        .select({ status: schema.agentRuns.status, output: schema.agentRuns.output, errorMessage: schema.agentRuns.errorMessage })
        .from(schema.agentRuns)
        .where(and(eq(schema.agentRuns.projectId, id), eq(schema.agentRuns.agentType, "packager")))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(1)
    )[0];
    if (!run) return { state: "none" as const };
    if (run.status === "pending" || run.status === "running") return { state: "running" as const };
    if (run.status === "cancelled") return { state: "none" as const };
    const out = (run.output ?? {}) as { ok?: boolean; kind?: "installer" | "bundle"; installerPath?: string; bundlePath?: string; error?: string };
    if (run.status === "failed") return { state: "failed" as const, error: run.errorMessage ?? "Falló al preparar el paquete." };
    // done/applied → el éxito real lo dice el output (el run no lanza excepción aunque no empaquete).
    if (out.ok) return { state: "done" as const, kind: out.kind ?? "installer", installerPath: out.installerPath, bundlePath: out.bundlePath };
    return { state: "failed" as const, error: out.error ?? "No se pudo preparar el paquete." };
  });

  // Cancelar el empaquetado en curso.
  app.post("/api/projects/:id/package/cancel", async (req) => {
    const { id } = req.params as { id: string };
    const run = (
      await db()
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(and(
          eq(schema.agentRuns.projectId, id),
          eq(schema.agentRuns.agentType, "packager"),
          inArray(schema.agentRuns.status, ["pending", "running"]),
        ))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(1)
    )[0];
    if (run) await cancel(run.id);
    return { ok: true };
  });

  // Abre el explorador con el instalador seleccionado (para copiarlo y repartirlo).
  app.post("/api/projects/:id/reveal-installer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = (
      await db()
        .select({ output: schema.agentRuns.output })
        .from(schema.agentRuns)
        .where(and(eq(schema.agentRuns.projectId, id), eq(schema.agentRuns.agentType, "packager")))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(1)
    )[0];
    const out = (run?.output as { installerPath?: string; bundlePath?: string } | null) ?? {};
    const artifact = out.installerPath ?? out.bundlePath; // .exe (escritorio) o .zip (despliegue)
    if (!artifact || !existsSync(artifact)) {
      return reply.code(404).send({ error: "No encuentro el paquete. Vuelve a prepararlo." });
    }
    const { shell } = await import("electron");
    shell.showItemInFolder(artifact); // selecciona el .exe / .zip en el explorador
    return { ok: true, path: artifact };
  });

  app.get("/api/projects/:id/execution", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db()
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.projectId, id))
      .orderBy(desc(schema.executions.createdAt))
      .limit(1);
    const exec = rows[0];
    if (!exec) return reply.code(404).send({ error: "sin ejecuciones" });

    const steps = await db()
      .select()
      .from(schema.executionSteps)
      .where(eq(schema.executionSteps.executionId, exec.id))
      .orderBy(asc(schema.executionSteps.ord));

    return { ...exec, phases: PHASES, steps };
  });
}
