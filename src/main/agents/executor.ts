import { promises as fs } from "node:fs";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { AppConfig, AppType } from "@shared";
import { db, schema } from "../db/client.js";
import { loadProjectCorpus } from "./corpus.js";
import { runPlanner } from "./planner.js";
import {
  applyDoneIds, markDone, parseDoneIds, pendingTasks, planToMarkdown, PLAN_MD_REL,
  type SprintPlan,
} from "./plan-md.js";
import { ensureArchitecture } from "../architecture.js";
import { reviewTests } from "./tests-review.js";
import { ensureAppDeps, runBuild } from "./qa-exec.js";
import { runBuilder, type BuilderResult } from "./builder.js";
import { materializeScaffold, resetWorkspace } from "./scaffold.js";
import { ensureMockupsForScreens } from "./mockup.js";
import { verifyVisual } from "./verify-visual.js";
import { appWorkspace, listAppFiles } from "./code-workspace.js";
import { commitGreen } from "../git/repo.js";
import { log } from "../log.js";

/**
 * Ejecutor del plan, motor de AGENTE ÚNICO. Prepara el contexto (corpus + plan + tipo de app +
 * tests congelados) y lanza UN agente builder (`builder.ts`) que construye/repara, compila, depura
 * y hace pasar las pruebas en un bucle de tools, con un gate determinista. Registra cada paso en
 * execution_steps para el túnel de la UI (fases a la izquierda, mensajes reales a la derecha) y, al
 * terminar, deja un informe MD en `planes/`.
 *
 * Sustituye a la orquestación rígida anterior (coder por sprint → compile-fix → iteración de QA),
 * que era la fuente de la fragilidad: el agente único lee su propio código, así que la incoherencia
 * se corrige sola en vez de degenerar en un bucle de "vuelve a empezar".
 */

export const PHASES = ["Recolección", "Análisis", "Construcción", "Validación", "Versión"] as const;

const nowIso = () => new Date().toISOString();

/**
 * El usuario NO sabe programar: un mensaje técnico crudo (stack trace, salida de tsc/npm, "ENOENT…")
 * no le sirve de nada y solo lo alarma. Registramos el detalle completo en los logs (para depurar) y
 * devolvemos SIEMPRE un texto en lenguaje llano para lo que ve él (chat / túnel de ejecución).
 */
function friendly(prefix: string, e?: unknown): string {
  if (e !== undefined) log.warn("executor", prefix, { err: e });
  return prefix;
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Project ${projectId} not found`);
  return rows[0];
}

async function latestPlanRow(projectId: string) {
  const rows = await db()
    .select({ id: schema.sprintPlans.id, planJson: schema.sprintPlans.planJson })
    .from(schema.sprintPlans)
    .where(eq(schema.sprintPlans.projectId, projectId))
    .orderBy(desc(schema.sprintPlans.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Registra los pasos de la ejecución conforme van ocurriendo. */
class Recorder {
  private ord = 0;
  constructor(private execId: string) {}
  async phase(p: string): Promise<void> {
    await db().update(schema.executions).set({ currentPhase: p }).where(eq(schema.executions.id, this.execId));
  }
  async add(phase: string, label: string): Promise<string> {
    const id = `step_${ulid().toLowerCase()}`;
    await db().insert(schema.executionSteps).values({
      id, executionId: this.execId, phase, label, status: "running", ord: this.ord++,
    });
    return id;
  }
  async done(id: string, detail?: string): Promise<void> {
    await db().update(schema.executionSteps)
      .set({ status: "done", detail: detail ?? null, finishedAt: nowIso() })
      .where(eq(schema.executionSteps.id, id));
  }
  async fail(id: string, detail?: string): Promise<void> {
    await db().update(schema.executionSteps)
      .set({ status: "failed", detail: detail ?? null, finishedAt: nowIso() })
      .where(eq(schema.executionSteps.id, id));
  }
}

export const runExecutor = {
  async run(runId: string, projectId: string, input: any, cfg: AppConfig) {
    const project = await getProject(projectId);
    const ws = appWorkspace(project.rootPath);
    const userFeedback: string | undefined = input?.feedback || undefined;
    const execId = `exec_${ulid().toLowerCase()}`;
    await db().insert(schema.executions).values({
      id: execId, projectId, status: "running", currentPhase: PHASES[0],
    });
    const rec = new Recorder(execId);
    let finalStatus: "done" | "failed" | "needs_input" = "failed";
    let finalError: string | null = null;

    // ── Modo PRUEBAS bajo demanda ── No reconstruye la app: solo escribe las pruebas de aceptación y las
    // audita, sobre el código YA construido. Se dispara tras el "OK" del usuario (validación) o si lo pide
    // antes voluntariamente. La reconciliación de docs se encola aparte (escriben ficheros distintos).
    if (input?.writeTests) {
      try {
        await rec.phase("Validación");
        const planRow = await latestPlanRow(projectId);
        const plan = (planRow?.planJson as SprintPlan) ?? null;
        const corpus = await loadProjectCorpus(project.rootPath, projectId);
        const appType = (await ensureArchitecture(projectId)).appType;
        const hasCode = (await listAppFiles(ws)).some((f) => /\.(ts|tsx|js|jsx|vue)$/.test(f) && !f.startsWith("tests/"));
        if (!hasCode) {
          const s = await rec.add("Validación", "Escribiendo las pruebas de aceptación");
          await rec.fail(s, "No hay aplicación construida todavía: constrúyela antes de crear las pruebas.");
          finalStatus = "failed";
          finalError = "No hay aplicación construida.";
        } else {
          await ensureAppDeps(ws);
          await runTestsAndReview(cfg, projectId, ws, plan, corpus, appType, rec);
          finalStatus = "done";
        }
      } catch (e: any) {
        finalStatus = "failed";
        log.error("executor", "fallo en la fase de pruebas bajo demanda", { err: e, projectId });
        finalError = friendly("Ha ocurrido un problema técnico al crear las pruebas. Vuelve a intentarlo en un momento.");
      }
      await db().update(schema.executions)
        .set({ status: finalStatus, error: finalError, finishedAt: nowIso() })
        .where(eq(schema.executions.id, execId));
      return { output: { executionId: execId, status: finalStatus }, requiresGate: false };
    }

    try {
      // ── Recolección ──
      await rec.phase("Recolección");
      const sRead = await rec.add("Recolección", "Leyendo documentos y plan");
      const corpus = await loadProjectCorpus(project.rootPath, projectId);
      await rec.done(sRead, "Documentos del proyecto cargados");

      // ── Análisis ── (carga/auto-genera el plan, respeta ediciones del usuario, calcula pendientes)
      await rec.phase("Análisis");
      const sAnalysis = await rec.add("Análisis", "Analizando el plan de desarrollo");

      const appType = (await ensureArchitecture(projectId)).appType;

      // Si no hay plan todavía, se genera automáticamente la primera vez.
      let planRow = await latestPlanRow(projectId);
      if (!planRow) {
        const sGenPlan = await rec.add("Análisis", "No había plan: generándolo automáticamente");
        try {
          const pr = await runPlanner.run(runId, projectId, { appType }, cfg);
          await runPlanner.apply(runId, projectId, pr.output as { plan: SprintPlan });
          planRow = await latestPlanRow(projectId);
          await rec.done(sGenPlan, "Plan generado");
        } catch (e: any) {
          await rec.fail(sGenPlan, friendly("No se pudo generar el plan de desarrollo automáticamente. Vuelve a intentarlo.", e));
        }
      }

      const plan: SprintPlan | null = (planRow?.planJson as SprintPlan) ?? null;
      let pendingIds: string[] = [];
      let planContext = "";
      if (plan && planRow) {
        // Respetar ediciones manuales: el estado de planes/plan.md manda (marcar/desmarcar tareas).
        try {
          const md = await fs.readFile(path.join(project.rootPath, PLAN_MD_REL), "utf-8");
          applyDoneIds(plan, parseDoneIds(md));
          await db().update(schema.sprintPlans).set({ planJson: plan as any }).where(eq(schema.sprintPlans.id, planRow.id));
        } catch { /* aún no hay plan.md */ }
        pendingIds = pendingTasks(plan).map((t) => t.id);
        planContext = planToMarkdown(plan);
        const total = (plan.sprints ?? []).reduce((n, s) => n + (s.tareas?.length ?? 0), 0);
        await rec.done(sAnalysis, `Plan analizado — ${pendingIds.length} tareas pendientes de ${total}`);
      } else {
        await rec.done(sAnalysis, "Se construye desde los documentos");
      }

      // "Reconstruir desde cero": vacía la app anterior (salvo node_modules) para partir del andamiaje
      // dorado fresco. Tolera ficheros en uso (no obliga al usuario a cerrar procesos a mano).
      if (input?.fromScratch) {
        await fs.mkdir(ws, { recursive: true });
        const sReset = await rec.add("Análisis", "Reconstruir desde cero — vaciando la app anterior");
        try {
          const r = await resetWorkspace(ws);
          await rec.done(sReset, `App anterior limpiada (${r.removed} elementos${r.failed.length ? `; ${r.failed.length} en uso, omitidos` : ""})`);
        } catch (e: any) {
          await rec.fail(sReset, friendly("No se pudo limpiar del todo la app anterior — puede que algún fichero esté en uso.", e));
        }
      }

      // ¿Ya hay código generado? → MODO REPARACIÓN: el agente repara el código existente (con tu
      // feedback del chat/pantalla) en vez de construir de cero. (Tras "reconstruir desde cero" estará vacío.)
      const alreadyBuilt = (await listAppFiles(ws)).some(
        (f) => /\.(ts|tsx|js|jsx|vue)$/.test(f) && !f.startsWith("tests/"),
      );

      // ── Construcción ── (el agente único: tests congelados como diana + builder en bucle de tools)
      await rec.phase("Construcción");
      await fs.mkdir(ws, { recursive: true });

      // ANDAMIAJE DORADO DETERMINISTA: en una generación FRESCA, el PROGRAMA coloca el andamiaje
      // conocido-bueno (que ya RENDERIZA) en _app/, en vez de fiarlo al LLM. Así los bugs estructurales
      // (pantalla en blanco, build mal, CSP) son imposibles por construcción; el agente solo añade encima.
      let scaffolded = false;
      if (!alreadyBuilt) {
        const sScaf = await rec.add("Construcción", "Colocando el andamiaje base de la aplicación");
        try {
          const files = await materializeScaffold(ws, appType);
          scaffolded = files.length > 0;
          await rec.done(sScaf, scaffolded ? `Andamiaje colocado (${files.length} ficheros, ya renderiza)` : "Sin andamiaje copiable para este tipo (se construye desde plantillas)");
        } catch (e: any) {
          await rec.fail(sScaf, friendly("No se pudo preparar la base de la aplicación. Vuelve a intentarlo.", e));
        }
      }

      // FORMULARIOS BASE: garantiza que cada pantalla tenga su maqueta (el "formulario" de Documentos)
      // ANTES de construir, para que el builder PARTA de ella (la reproduce y luego cablea la lógica) en
      // vez de diseñar la pantalla desde cero. Idempotente (solo genera las que falten). Solo apps con UI.
      if (appType === "electron" || appType === "server") {
        const sForms = await rec.add("Construcción", "Preparando los formularios base de las pantallas");
        try {
          const r = await ensureMockupsForScreens(cfg, projectId, appType);
          await rec.done(sForms, r.total
            ? `Formularios listos — ${r.total} pantalla(s)${r.generated ? `, ${r.generated} preparada(s) ahora` : ""}`
            : "No hay pantallas que preparar todavía");
        } catch (e: any) {
          await rec.done(sForms, friendly("No se pudieron preparar todos los formularios de las pantallas — se completarán durante la construcción.", e));
        }
      }

      // El presupuesto de ciclos escala con el TAMAÑO del plan (1 pantalla ≠ web de 16 pantallas): una app
      // grande que avanza no se corta a medias, y una pequeña no malgasta (termina en cuanto da verde). El
      // estancamiento (3 ciclos sin mejorar) sigue cortando antes si se atasca de verdad.
      const appCycles = cyclesForPlan(plan, "app");

      // Un paso de la UI por cada ciclo del agente: se abre en onCycle y se cierra en onGate.
      const cycleSteps = new Map<number, string>();
      const result: BuilderResult = await runBuilder(cfg, ws, {
        projectId,
        appType,
        planContext: planContext || undefined,
        userFeedback,
        repair: alreadyBuilt,
        scaffolded,
        goal: "app",
        maxCycles: appCycles,
        progress: {
          onCycle: async (cycle, toolsUsed) => {
            const top = summarizeTools(toolsUsed);
            const id = await rec.add("Construcción", `${alreadyBuilt ? "Reparando" : "Construyendo"} — ciclo ${cycle + 1}`);
            cycleSteps.set(cycle, id);
            // Detalle provisional; el veredicto real lo pone onGate al cerrar el paso.
            if (top) await db().update(schema.executionSteps).set({ detail: top }).where(eq(schema.executionSteps.id, id));
          },
          onGate: async (cycle, info) => {
            const id = cycleSteps.get(cycle);
            if (!id) return;
            if (info.compiledGreen && (info.testsFailed === null || info.testsFailed === 0)) {
              await rec.done(id, "Compila ✓" + (info.testsFailed === 0 ? " y las pruebas pasan ✓" : ""));
            } else if (!info.compiledGreen) {
              await rec.fail(id, `${info.compileErrors} error(es) de compilación`);
            } else {
              await rec.fail(id, `Compila ✓, pero ${info.testsFailed} prueba(s) fallan`);
            }
          },
        },
      });

      // ── Validación ──
      await rec.phase("Validación");
      const sVal = await rec.add("Validación", "Comprobación final (compila + pruebas)");
      const passed = result.status === "green";
      if (passed) {
        await rec.done(sVal, `Compila sin errores${result.testsRan ? ` · ${result.testsTotal - result.testsFailed}/${result.testsTotal} pruebas pasan` : ""} ✓`);
        // Verificación de arranque (best-effort): el build REAL de la app emite/empaqueta (más fuerte
        // que --noEmit) y, en escritorio, produce el renderer para la verificación visual. No invalida
        // el verde si se omite o no concluye; solo informa.
        const sBuild = await rec.add("Validación", "Verificando el arranque (build real)");
        try {
          await ensureAppDeps(ws); // host si no hay Docker; necesario para construir el renderer
          const smoke = await runBuild(ws, appType);
          if (smoke.skipped) await rec.done(sBuild, `Verificación de arranque omitida — ${smoke.skipped}`);
          else if (smoke.ran && smoke.ok) await rec.done(sBuild, "La app construye/empaqueta sin errores ✓");
          else {
            log.warn("executor", "el build final emitió errores (no bloquea la versión)", { output: smoke.output.slice(-2000) });
            await rec.fail(sBuild, "El empaquetado final ha dado algún aviso, pero no afecta a la versión ya guardada.");
          }
        } catch (e: any) {
          await rec.done(sBuild, friendly("Verificación de arranque no concluyente — no afecta a la versión ya guardada.", e));
        }

        // Las PRUEBAS de aceptación ya NO se crean aquí: se escriben tras el "OK" del usuario (validación),
        // o antes si él lo pide voluntariamente. Ver la fase `writeTests` (runTestsAndReview) más abajo.

        // Verificación VISUAL (escritorio): lanza el renderer construido en una ventana oculta y captura
        // un screenshot para confirmar que se VE algo (no pantalla en blanco). Best-effort, no bloquea.
        if (appType === "electron") {
          const sVis = await rec.add("Validación", "Verificación visual (captura del renderizado)");
          try {
            const vis = await verifyVisual(ws, appType);
            if (vis.skipped) await rec.done(sVis, `Verificación visual omitida — ${vis.skipped}`);
            else if (vis.ok) await rec.done(sVis, `La interfaz renderiza correctamente ✓${vis.screenshot ? `\n${vis.screenshot}` : ""}`);
            else {
              log.warn("executor", "la interfaz no renderiza bien", { findings: vis.findings });
              await rec.fail(sVis, `La interfaz podría no verse del todo bien (no bloquea la versión guardada).${vis.screenshot ? `\n${vis.screenshot}` : ""}`);
            }
          } catch (e: any) {
            await rec.done(sVis, friendly("Verificación visual no concluyente — no afecta a la versión ya guardada.", e));
          }
        }
      } else if (result.status === "unsupported") {
        await rec.fail(sVal, "El modelo de código no soporta el uso de herramientas (function-calling). Configura un modelo con tool-calling.");
      } else {
        await rec.fail(sVal, result.compiledGreen
          ? `Pruebas en rojo: ${result.testsFailed}/${result.testsTotal} fallan`
          : `Estancado en ${result.compileErrors} error(es) de compilación`);
      }

      if (passed) {
        // ── Versión ──
        await rec.phase("Versión");
        const sV = await rec.add("Versión", "Guardando una versión que funciona");
        const hash = await commitGreen(ws, project.name);
        await rec.done(sV, hash ? "Versión guardada" : "Sin cambios que guardar");

        // Marcar como hechas las tareas que esta construcción ha completado + actualizar el plan vivo.
        if (plan && planRow && pendingIds.length) {
          try {
            markDone(plan, pendingIds);
            await db().update(schema.sprintPlans).set({ planJson: plan as any }).where(eq(schema.sprintPlans.id, planRow.id));
            await fs.writeFile(path.join(project.rootPath, PLAN_MD_REL), planToMarkdown(plan), "utf-8");
            const sMark = await rec.add("Versión", `Plan actualizado — ${pendingIds.length} tareas marcadas como hechas`);
            await rec.done(sMark);
          } catch (e) {
            log.warn("executor", "no se pudo actualizar el plan vivo", { err: e });
          }
        }
        // El build incorporó los DOCUMENTOS actuales (el builder los lee en vivo) → el plan queda
        // SINCRONIZADO con la doc en este momento: refrescamos su marca para que "Plan caducado" signifique
        // "cambiaste requisitos DESDE la última construcción" (no "desde que se generó el plan", que lo
        // dejaba caducado para siempre). Se toca updatedAt aunque no hubiera tareas pendientes que marcar.
        if (planRow) {
          try {
            await db().update(schema.sprintPlans).set({ updatedAt: nowIso() }).where(eq(schema.sprintPlans.id, planRow.id));
          } catch (e) { log.warn("executor", "no se pudo refrescar la marca del plan", { err: e }); }
        }
        // Versión guardada → pedir al usuario una VALIDACIÓN TOTAL. Cuando la dé por válida (en el
        // chat o con el botón "He validado"), se reconcilia la documentación con lo que el código hace.
        await askUserToValidate(projectId, project.name, appType);
        finalStatus = "done";
        finalError = null;
      } else {
        // El agente no llegó a verde → se pide ayuda a la persona con el diagnóstico real.
        const detail = buildEscalation(result);
        const sAsk = await rec.add("Validación", "No consigo terminarlo — te pido ayuda");
        await askUserInChat(projectId, project.name, detail);
        await rec.done(sAsk, "Te he dejado una pregunta en el chat");
        finalStatus = "needs_input";
        finalError = detail;
      }

      await writeExecutionReport(project.rootPath, execId, project.name, finalStatus);
      await db().update(schema.executions)
        .set({ status: finalStatus, error: finalError, finishedAt: nowIso() })
        .where(eq(schema.executions.id, execId));
    } catch (e: any) {
      // Si se canceló mientras corría, respetar la cancelación: no pisar "cancelled" con "failed".
      const cur = await db()
        .select({ status: schema.executions.status })
        .from(schema.executions)
        .where(eq(schema.executions.id, execId));
      if (cur[0]?.status === "cancelled") {
        log.info("executor", "ejecución cancelada por el usuario", { projectId });
        return { output: { executionId: execId, status: "cancelled" }, requiresGate: false };
      }
      log.error("executor", "fallo en la ejecución del plan", { err: e, projectId });
      await db().update(schema.executions)
        .set({
          status: "failed",
          error: "Ha ocurrido un problema técnico inesperado construyendo la aplicación. Vuelve a intentarlo.",
          finishedAt: nowIso(),
        })
        .where(eq(schema.executions.id, execId));
    }

    return { output: { executionId: execId, status: finalStatus }, requiresGate: false };
  },
};

/** Resume las tools que el agente usó en un ciclo, como "compilar ×3, escribir_fichero ×5". */
function summarizeTools(toolsUsed: string[]): string {
  if (!toolsUsed.length) return "";
  const counts = new Map<string, number>();
  for (const t of toolsUsed) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(", ");
}

/**
 * Presupuesto de ciclos del builder según el TAMAÑO del plan (nº de tareas). Una app de 1 pantalla y una
 * web con API de 16 pantallas no pueden tener el mismo techo. La fase de tests pide algo menos que la de
 * app (escribir pruebas cuesta menos que construir dominio + UI). Acotado para no ir a 0 ni a infinito.
 * Ejemplos app: 4 tareas→7 ciclos · 10→12 · 20→20 · 35+→30 (tope). Tests: 4→5 · 10→8 · 20→13 · 34+→20.
 */
function cyclesForPlan(plan: SprintPlan | null, kind: "app" | "tests"): number {
  const tasks = (plan?.sprints ?? []).reduce((n, s) => n + (s.tareas?.length ?? 0), 0);
  if (kind === "tests") return Math.max(5, Math.min(20, Math.ceil(tasks * 0.5) + 3));
  return Math.max(6, Math.min(30, Math.ceil(tasks * 0.8) + 4));
}

/**
 * FASE DE PRUEBAS bajo demanda: escribe las pruebas de aceptación REALES (pase del builder DEDICADO, con
 * presupuesto propio según el plan) y luego las audita. La app ya debe estar construida y compilando.
 * Best-effort: no lanza; registra los pasos en `rec`. Se invoca tras el "OK" del usuario o si lo pide antes.
 */
async function runTestsAndReview(
  cfg: AppConfig, projectId: string, ws: string, plan: SprintPlan | null,
  corpus: string, appType: AppType, rec: Recorder,
): Promise<void> {
  const sTests = await rec.add("Validación", "Escribiendo las pruebas de aceptación");
  try {
    const tRes = await runBuilder(cfg, ws, {
      projectId, appType,
      planContext: plan ? planToMarkdown(plan) : undefined,
      repair: true, scaffolded: false, goal: "tests", maxCycles: cyclesForPlan(plan, "tests"),
    });
    if (tRes.status === "green") await rec.done(sTests, `Pruebas creadas y en verde ✓ (${tRes.testsTotal} prueba(s))`);
    else await rec.fail(sTests, "No he conseguido dejar terminadas las pruebas de aceptación tras varios intentos. La revisión de abajo lo detalla.");
  } catch (e: any) {
    await rec.done(sTests, friendly("Fase de pruebas no concluyente. Puedes pedir que se reintente cuando quieras.", e));
  }

  const sRev = await rec.add("Validación", "Revisión de las pruebas (cobertura y calidad)");
  try {
    const review = await reviewTests(cfg, ws, corpus);
    if (review.skipped) await rec.done(sRev, `Revisión omitida — ${review.skipped}`);
    else if (review.ok) await rec.done(sRev, `Las pruebas ejercitan el código y cubren los criterios ✓${review.summary ? `\n${review.summary}` : ""}`);
    else await rec.fail(sRev, `Aviso de cobertura:\n${review.findings.slice(0, 6).map((f) => `• ${f}`).join("\n")}`);
  } catch (e: any) {
    await rec.done(sRev, friendly("Revisión de pruebas no concluyente.", e));
  }
}

/**
 * Texto de escalado a la persona cuando el agente no llega a verde. NUNCA incluye texto técnico crudo
 * (salida del compilador, stacks…) — el usuario no sabe programar y no puede hacer nada con eso; el
 * detalle completo queda en los logs (ver "estancado" en builder.ts) para quien depure. Solo escalamos
 * con algo que la PERSONA sí puede responder (qué debe hacer la pantalla, qué criterio es ambiguo…); un
 * estancamiento puramente de compilación ya ha agotado un margen extra de reintentos automáticos antes
 * de llegar aquí (ver COMPILE_STALL_LIMIT en builder.ts), así que insistir con más detalle técnico no
 * ayudaría — se ofrece reintentar en vez de explicar el error.
 */
function buildEscalation(r: BuilderResult): string {
  if (r.status === "unsupported") {
    return "El modelo de IA configurado para generar código no es compatible con esta aplicación. " +
      "Revísalo en Ajustes y vuelve a intentarlo.";
  }
  if (!r.compiledGreen) {
    return "He tenido un problema técnico terminando la parte interna de la aplicación tras varios intentos con " +
      "enfoques distintos. No es algo que tengas que resolver tú: puedo intentarlo de nuevo (a veces basta con " +
      "reintentar), o si quieres, dime si prefieres simplificar alguna parte de lo pedido.";
  }
  if (r.uiPending) {
    return "La aplicación funciona por dentro, pero no terminé de construir las PANTALLAS reales tras varios " +
      "intentos. Cuéntame qué debería mostrar/hacer esa pantalla y lo reintento.";
  }
  if (r.testsRan && r.testsFailed > 0) {
    return `La aplicación funciona, pero ${r.testsFailed} de ${r.testsTotal} pruebas de aceptación siguen sin ` +
      "pasar tras varios intentos. Puede que algún requisito no quedara del todo claro: cuéntame más detalle y lo reviso.";
  }
  return "Me he quedado atascado antes de terminar tras varios intentos. Cuéntame qué falta o qué debería hacer y lo reintento.";
}

/** Tras agotar los intentos, deja una pregunta del asistente en la conversación del proyecto. */
async function askUserInChat(projectId: string, projectName: string, report: string): Promise<void> {
  try {
    const sessions = await db()
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.projectId, projectId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);
    let sessionId = sessions[0]?.id;
    if (!sessionId) {
      sessionId = `sess_${ulid().toLowerCase()}`;
      await db().insert(schema.sessions).values({ id: sessionId, projectId, title: "Construcción de la app" });
    }

    const content = [
      `He intentado construir **${projectName}**, pero no consigo dejarlo terminado del todo.`,
      ``,
      `**Lo que está fallando:** ${report}`,
      ``,
      `¿Cómo prefieres que siga? Puedes pedirme que simplifique alguna parte, ajustar algún requisito, o darme más detalle de cómo debería funcionar lo que falla. Cuando me lo cuentes, lo vuelvo a intentar.`,
    ].join("\n");

    await db().insert(schema.messages).values({
      id: `msg_${ulid().toLowerCase()}`,
      projectId,
      sessionId,
      role: "assistant",
      content,
      metadata: { kind: "executor-escalation" },
    });
  } catch (e) {
    log.warn("executor", "no se pudo dejar la pregunta en el chat", { err: e });
  }
}

/**
 * Tras guardar una versión, pide al usuario una VALIDACIÓN COMPLETA de la app y le explica que, cuando
 * la dé por válida, se ajustará toda la documentación al código real. Es un paso clave: la doc deja de
 * ser "lo que se pidió" para pasar a ser "lo que la app hace de verdad", una vez la persona lo confirma.
 */
async function askUserToValidate(projectId: string, projectName: string, appType: AppType): Promise<void> {
  try {
    const sessions = await db()
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.projectId, projectId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);
    let sessionId = sessions[0]?.id;
    if (!sessionId) {
      sessionId = `sess_${ulid().toLowerCase()}`;
      await db().insert(schema.sessions).values({ id: sessionId, projectId, title: "Construcción de la app" });
    }

    const comoProbar = appType === "server"
      ? `pulsa **"Probar la aplicación"** en la pantalla de Generar (la abro en tu navegador, sin que instales nada) y prueba **todos** los flujos y pantallas`
      : appType === "mcp"
        ? `conéctala a tu cliente MCP (Claude Desktop, Cursor…) y prueba **todas** sus tools y recursos`
        : appType === "api"
          ? `pulsa **"Probar el servicio"** en la pantalla de Generar (abro su página de estado y te muestro la API key) y comprueba sus endpoints con la clave`
          : `ábrela y prueba **todos** los flujos y pantallas de principio a fin`;
    const content = [
      `✅ He construido y guardado una versión de **${projectName}**.`,
      ``,
      `**Antes de darla por buena, valida la aplicación COMPLETA.** Es importante: ${comoProbar} —crear, editar, borrar, exportar, casos límite…—. Que compile no garantiza que haga lo que necesitas: compruébalo tú.`,
      ``,
      `Cuando la hayas validado del todo, **dímelo aquí** (o pulsa **"He validado la app"** en la pantalla de Generar). Entonces **crearé las pruebas de aceptación** que codifican lo que acabas de validar y **ajustaré toda la documentación** —papers, reglas de negocio, pantallas y el README— para que refleje EXACTAMENTE lo que hace la app. Si algo no te cuadra, cuéntamelo y lo reparo antes. (Si prefieres crear las pruebas ya, hay un botón "Crear las pruebas ahora".)`,
    ].join("\n");

    await db().insert(schema.messages).values({
      id: `msg_${ulid().toLowerCase()}`,
      projectId,
      sessionId,
      role: "assistant",
      content,
      metadata: { kind: "version-validation" },
    });
  } catch (e) {
    log.warn("executor", "no se pudo dejar la petición de validación en el chat", { err: e });
  }
}

/** Escribe en `planes/` un MD con todo lo que se ha ido creando en esta ejecución. */
async function writeExecutionReport(
  rootPath: string,
  execId: string,
  projectName: string,
  status: "done" | "failed" | "needs_input",
): Promise<void> {
  try {
    const steps = await db()
      .select()
      .from(schema.executionSteps)
      .where(eq(schema.executionSteps.executionId, execId))
      .orderBy(asc(schema.executionSteps.ord));

    const stamp = new Date();
    const lines: string[] = [
      `# Ejecución — ${projectName}`,
      ``,
      `**Fecha:** ${stamp.toLocaleString()}`,
      `**Resultado:** ${
        status === "done"
          ? "✅ Completada"
          : status === "needs_input"
            ? "❓ Necesita tu ayuda (pregunta dejada en el chat)"
            : "⛔ No superó la validación"
      }`,
      ``,
    ];
    let lastPhase = "";
    for (const s of steps) {
      if (s.phase !== lastPhase) {
        lines.push(`## ${s.phase}`, ``);
        lastPhase = s.phase;
      }
      const mark = s.status === "done" ? "x" : " ";
      lines.push(`- [${mark}] ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
    }
    lines.push("");

    const dir = path.join(rootPath, "planes");
    await fs.mkdir(dir, { recursive: true });
    const fname = `ejecucion-${stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    await fs.writeFile(path.join(dir, fname), lines.join("\n"), "utf-8");
  } catch (e) {
    log.warn("executor", "no se pudo escribir el informe en planes/", { err: e });
  }
}
