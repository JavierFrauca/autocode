import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { chat } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { extractJson } from "../llm/json.js";
import { loadProjectCorpus } from "./corpus.js";
import { appWorkspace, listAppFiles, readAppFile } from "./code-workspace.js";
import { listDocuments } from "../tools/knowledge.js";
import { saveProjectDocument } from "../papers/save.js";
import { log } from "../log.js";

/**
 * Reconciliador de documentación. Tras VALIDAR el usuario la app construida, ajusta los papers de
 * negocio (reglas, dominios, pantallas…) y el README para que reflejen EXACTAMENTE lo que el código
 * hace de verdad — ingeniería inversa de la doc desde el código validado. La fuente de verdad pasa a
 * ser el código validado: donde diverjan, manda el código.
 */

interface ReconcilerInput {
  /** Notas que el usuario dejó al dar la app por válida (opcional). */
  feedback?: string;
}

interface ReconciledDoc {
  ruta: string;
  contenido: string;
  titulo?: string;
  tags?: string[];
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Proyecto ${projectId} no encontrado`);
  return rows[0];
}

/** Lee una porción curada del código de NEGOCIO (dominio/servicios/casos de uso), acotada en tamaño. */
async function collectBusinessCode(ws: string, maxChars = 40_000): Promise<string> {
  const files = await listAppFiles(ws);
  const isBiz = (p: string) =>
    /(^|\/)(domain|application|dominio|servicios?|services?|usecases?|casos)/i.test(p) &&
    /\.(ts|tsx|js)$/.test(p) && !/\.(test|spec)\./.test(p);
  const blocks: string[] = [];
  let total = 0;
  for (const f of files.filter(isBiz)) {
    const c = await readAppFile(ws, f);
    if (c == null) continue;
    const block = `### ${f}\n\`\`\`ts\n${c.slice(0, 4_000)}\n\`\`\``;
    if (total + block.length > maxChars) break;
    blocks.push(block);
    total += block.length;
  }
  return blocks.join("\n\n");
}

/** Deja un mensaje del asistente en la conversación del proyecto. */
async function postChat(projectId: string, content: string, kind: string): Promise<void> {
  try {
    const sess = await db()
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.projectId, projectId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);
    let sessionId = sess[0]?.id;
    if (!sessionId) {
      sessionId = `sess_${ulid().toLowerCase()}`;
      await db().insert(schema.sessions).values({ id: sessionId, projectId, title: "Construcción de la app" });
    }
    await db().insert(schema.messages).values({
      id: `msg_${ulid().toLowerCase()}`, projectId, sessionId, role: "assistant", content, metadata: { kind },
    });
  } catch (e) {
    log.warn("reconciler", "no se pudo dejar el mensaje en el chat", { err: e });
  }
}

export const runReconciler = {
  async run(runId: string, projectId: string, input: ReconcilerInput, cfg: AppConfig) {
    const project = await getProject(projectId);
    const ws = appWorkspace(project.rootPath);

    const corpus = await loadProjectCorpus(project.rootPath, projectId);
    const code = await collectBusinessCode(ws);
    const docs = await listDocuments(projectId);
    const system = await loadPrompt("reconciler-system");

    const feedbackBlock = input?.feedback?.trim()
      ? `\n\nNOTAS DEL USUARIO AL VALIDAR (tenlas en cuenta):\n${input.feedback.trim()}`
      : "";
    const user =
      `PROYECTO: ${project.name}\n\n` +
      `DOCUMENTOS ACTUALES (papers de negocio):\n${corpus || "(sin documentos)"}\n\n` +
      `RUTAS DE DOCUMENTOS EXISTENTES:\n${docs.map((d) => `- ${d.path}`).join("\n") || "(ninguna)"}\n\n` +
      `LO QUE EL CÓDIGO HACE DE VERDAD (dominio/servicios validados):\n${code || "(no se encontró código de negocio)"}` +
      `${feedbackBlock}\n\n` +
      `Devuelve el JSON con el README y los documentos a crear/actualizar para que la doc refleje el código.`;

    const res = await chat(
      cfg, "docs",
      [{ role: "system", content: system }, { role: "user", content: user }],
      // Sin jsonMode/maxTokens: los modelos de razonamiento (deepseek-v4-pro) no soportan json_object y el
      // razonamiento consume el cap → content vacío. El prompt pide JSON y extractJson es robusto.
      { temperature: 0.2 },
      "reconciler",
    );

    let parsed: { readme?: string; documents?: ReconciledDoc[]; resumen?: string };
    try { parsed = extractJson(res.content); } catch { parsed = {}; }

    const updated: string[] = [];

    // README a disco (raíz del proyecto). No lo metemos como paper de negocio.
    if (typeof parsed.readme === "string" && parsed.readme.trim()) {
      try {
        await fs.writeFile(path.join(project.rootPath, "README.md"), parsed.readme, "utf-8");
        updated.push("README.md");
      } catch (e) {
        log.warn("reconciler", "no se pudo escribir README.md", { err: e });
      }
    }

    // Papers de negocio vía el camino único (disco + BD + índice semántico).
    for (const d of parsed.documents ?? []) {
      if (!d?.ruta || typeof d.contenido !== "string" || !d.contenido.trim()) continue;
      if (!String(d.ruta).toLowerCase().endsWith(".md")) continue;
      try {
        const saved = await saveProjectDocument(cfg, projectId, {
          ruta: d.ruta, contenido: d.contenido, titulo: d.titulo, tags: d.tags, agentRunId: runId,
        });
        updated.push(saved.ruta);
      } catch (e) {
        log.warn("reconciler", "no se pudo guardar el documento reconciliado", { err: e, ruta: d.ruta });
      }
    }

    log.info("reconciler", "documentación reconciliada", { actualizados: updated.length });

    // La reconciliación alinea la DOC con el código ya construido (no son requisitos NUEVOS): refrescamos
    // la marca del último plan a AHORA —después de escribir los docs— para que estos cambios no dejen el
    // plan "caducado". Solo un cambio de requisitos POSTERIOR del usuario volverá a marcarlo.
    try {
      const planRow = (await db()
        .select({ id: schema.sprintPlans.id })
        .from(schema.sprintPlans)
        .where(eq(schema.sprintPlans.projectId, projectId))
        .orderBy(desc(schema.sprintPlans.createdAt))
        .limit(1))[0];
      if (planRow) {
        await db().update(schema.sprintPlans).set({ updatedAt: new Date().toISOString() }).where(eq(schema.sprintPlans.id, planRow.id));
      }
    } catch (e) {
      log.warn("reconciler", "no se pudo refrescar la marca del plan tras reconciliar", { err: e });
    }

    const resumen = parsed.resumen?.trim();
    const lista = updated.length ? updated.map((r) => `- ${r}`).join("\n") : "(sin cambios)";
    await postChat(
      projectId,
      `📚 He ajustado la documentación para que refleje la aplicación validada.\n\n` +
        (resumen ? `${resumen}\n\n` : "") +
        `**Documentos actualizados (${updated.length}):**\n${lista}`,
      "docs-reconciled",
    );

    return {
      output: { updated },
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      modelRole: "docs",
      modelName: res.model,
      requiresGate: false,
    };
  },
};
