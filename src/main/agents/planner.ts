import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppConfig, AppType } from "@shared";
import { db, schema } from "../db/client.js";
import { chat, runToolLoop } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { extractJson } from "../llm/json.js";
import { buildPlannerTools } from "../tools/governance-tools.js";
import { log } from "../log.js";
import { ulid } from "ulid";
import {
  applyDoneIds, parseDoneIds, planToMarkdown, PLAN_MD_REL, type SprintPlan,
} from "./plan-md.js";

interface PlannerInput {
  appType: AppType;
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Project ${projectId} not found`);
  return rows[0];
}

async function loadProjectDocs(rootPath: string): Promise<string> {
  const docs: string[] = [];
  const categories = ["decisiones", "reglas", "pantallas"];
  for (const cat of categories) {
    const dir = path.join(rootPath, cat);
    try {
      const files = await fs.readdir(dir);
      for (const f of files.filter((x) => x.endsWith(".md"))) {
        try {
          const content = await fs.readFile(path.join(dir, f), "utf-8");
          docs.push(`### ${cat}/${f}\n${content}`);
        } catch {}
      }
    } catch {}
  }
  return docs.length > 0 ? docs.join("\n\n---\n\n") : "(sin documentos todavía)";
}

export const runPlanner = {
  async run(_runId: string, projectId: string, input: PlannerInput, cfg: AppConfig) {
    const project = await getProject(projectId);
    const system = await loadPrompt("planner-system");
    const tipo = `Proyecto: ${project.name}\nTipo: ${input.appType ?? "server"}`;

    // Si ya hay un plan vivo, lo pasamos para que el modelo lo amplíe/modifique conservando ids
    // (y así no perdemos el estado de las tareas ya hechas al regenerar).
    let existingBlock = "";
    try {
      const prev = await fs.readFile(path.join(project.rootPath, PLAN_MD_REL), "utf-8");
      if (prev.trim()) {
        existingBlock =
          `\n\nPLAN ACTUAL (amplíalo o modifícalo CONSERVANDO los ids de las tareas existentes y su ` +
          `estado; añade tareas nuevas al final del sprint que corresponda):\n\n${prev}`;
      }
    } catch { /* primer plan */ }

    // Sin maxTokens (un plan grande puede pasarse de 8000) ni jsonMode (los modelos de RAZONAMIENTO no
    // soportan response_format json_object → content vacío). El prompt exige JSON y extractJson es robusto.
    // La SÍNTESIS del plan piensa (`thinking: "high"`) por calidad; las CONSULTAS del tool-loop van en
    // non-think (rápido). Solo afecta a proveedores directos mapeados (DeepSeek); en LiteLLM/local no se manda.
    const opts = { temperature: 0.1, thinking: "high" } as const;
    let content = "";
    let res: { content: string; tokensIn: number; tokensOut: number; model: string } | null = null;

    // 1) AGÉNTICO: el planner CONSULTA la doc del proyecto + la biblioteca con tools (en vez de meterle
    //    todo el corpus en el prompt). Escala a proyectos grandes y el modelo lee solo lo que necesita.
    try {
      const tools = buildPlannerTools(cfg, projectId);
      const kickoff =
        `${tipo}\n\nConsulta la documentación del proyecto con tus tools (decisiones, reglas, pantallas, ` +
        `patrones, media) y la biblioteca de AutoCode para entender qué construir y con qué patrones/` +
        `plantillas cuentas. Lee al menos decisiones y reglas antes de planificar.${existingBlock}`;
      const loop = await runToolLoop(
        cfg, "code",
        [{ role: "system", content: system }, { role: "user", content: kickoff }],
        tools, "planner", 16,
        false, // consultas en non-think: decidir qué docs leer no necesita razonar → mucho más rápido
      );
      // Solo cuenta si el modelo SOPORTA tools y de hecho CONSULTÓ algo; si no, caemos a texto.
      if (loop.supported && loop.toolsUsed.length > 0) {
        res = await chat(
          cfg, "code",
          [...(loop.messages as any), { role: "user", content: "Devuelve AHORA el JSON del plan de sprints (solo JSON, sin texto adicional)." }],
          opts, "planner",
        );
        content = res.content;
        log.info("planner", "modo agéntico", { tools: loop.toolsUsed.length });
      }
    } catch (e) {
      log.warn("planner", "modo agéntico falló; uso fallback de texto", { err: e });
    }

    // 2) FALLBACK de TEXTO: corpus completo en el prompt (modelos sin function-calling, o si lo agéntico
    //    no recabó/no devolvió nada). Es el comportamiento clásico.
    if (!content.trim()) {
      const corpus = await loadProjectDocs(project.rootPath);
      res = await chat(
        cfg, "code",
        [
          { role: "system", content: system },
          { role: "user", content: `${tipo}\n\nDocumentación del proyecto:\n\n${corpus}${existingBlock}\n\nDevuelve el JSON del plan de sprints.` },
        ],
        opts, "planner",
      );
      content = res.content;
    }

    let plan: SprintPlan;
    try {
      plan = extractJson<SprintPlan>(content);
    } catch (e: any) {
      throw new Error(
        `validation_error: planner no devolvió JSON válido (${e?.message ?? e}). Inicio: ${content.slice(0, 200)}`,
      );
    }

    return {
      output: { plan },
      tokensIn: res?.tokensIn ?? 0,
      tokensOut: res?.tokensOut ?? 0,
      modelRole: "code",
      modelName: res?.model ?? "",
      // SIN gate: nadie aplicaba el gate (el frontend solo hace poll de "done"), así que el plan
      // se generaba pero NUNCA se guardaba → la pantalla se reseteaba en silencio. Auto-aplicamos:
      // el plan se guarda solo (es editable después en planes/plan.md y se puede regenerar).
      requiresGate: false,
    };
  },

  async apply(_runId: string, projectId: string, output: { plan: SprintPlan }): Promise<void> {
    const project = await getProject(projectId);
    const plan = output.plan;

    // Conservar marcas: si ya existía un plan.md (con casillas [x]), mantenemos esos ids como
    // hechos al regenerar — así ampliar/modificar el plan no pierde lo ya completado.
    const planAbs = path.join(project.rootPath, PLAN_MD_REL);
    try {
      const prev = await fs.readFile(planAbs, "utf-8");
      applyDoneIds(plan, parseDoneIds(prev));
    } catch { /* primer plan */ }

    // Estructura para el resto del sistema (referencia).
    const planDir = path.join(project.rootPath, "_plan");
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "sprint-plan.json"), JSON.stringify(plan, null, 2), "utf-8");

    // Plan VIVO y editable (único fichero en planes/, con casillas).
    await fs.mkdir(path.dirname(planAbs), { recursive: true });
    await fs.writeFile(planAbs, planToMarkdown(plan), "utf-8");

    // BD.
    const planId = `plan_${ulid().toLowerCase()}`;
    await db().insert(schema.sprintPlans).values({
      id: planId,
      projectId,
      planJson: plan as any,
      status: "active",
    });
  },
};
