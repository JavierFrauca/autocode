import { promises as fs } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { chat } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { extractJson } from "../llm/json.js";
import { loadConfig } from "../config.js";
import { log } from "../log.js";
import { deleteProjectDocument, safeRelPath, saveProjectDocument } from "../papers/save.js";
import { nextDocNumberInDir } from "../papers/numbering.js";
import { isScreenDoc } from "./mockup.js";
import { deleteScreen, saveScreenSpec } from "../screens/service.js";

interface DocumenterInput {
  sessionId: string;
  triggerMessageId: string;
}

interface FileProp {
  coleccion: "project" | "templates";
  docType?: "decision" | "rule" | "screen" | "domain" | "pattern";
  transversal?: boolean;
  ruta: string;
  accion: "upsert" | "delete";
  titulo?: string;
  tags?: string[];
  contenido?: string;
}

interface DocumenterOutput {
  historial?: {
    sessionId: string;
    turno: { usuario: string; asistente: string };
  };
  ficheros: FileProp[];
}

async function getProject(projectId: string) {
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Project ${projectId} not found`);
  return rows[0];
}

// Contexto del documenter: SIEMPRE incluimos los primeros mensajes (la especificación
// fundacional, donde viven las reglas de negocio) + los últimos. Si solo miráramos los últimos N,
// la spec inicial se sale de la ventana en conversaciones largas y no se documenta nunca — que es
// justo lo que pasaba con las reglas de negocio.
async function buildDocContext(sessionId: string, head = 6, tail = 24) {
  const all = await db()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.createdAt));
  if (all.length <= head + tail) return all;
  const seen = new Set<string>();
  return [...all.slice(0, head), ...all.slice(-tail)].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// El documenter es de un solo disparo (no llama tools), y antes no veía qué documentos ya existían:
// por eso numeraba siempre desde 001 y creaba duplicados (ADR-001 ×3, RN-004 ×4...). Le damos un
// ANCLA determinista: el próximo número libre de cada prefijo + la lista de los que ya existen, para
// que reutilice la ruta exacta al actualizar y use el siguiente número al crear.
async function buildNumberingHint(rootPath: string): Promise<string> {
  try {
    const [adr, rn] = await Promise.all([
      nextDocNumberInDir(rootPath, "ADR", "decisiones"),
      nextDocNumberInDir(rootPath, "RN", "reglas"),
    ]);
    const existing = [...adr.existentes, ...rn.existentes].map((e) => `  - ${e.ruta}`);
    const lines = [
      "NUMERACIÓN (ancla obligatoria — NO repitas números ni dupliques documentos):",
      `- Próximo ADR libre: ADR-${adr.nextPadded} → al CREAR uno nuevo usa "decisiones/ADR-${adr.nextPadded}-<slug>.md".`,
      `- Próximo RN libre: RN-${rn.nextPadded} → al CREAR uno nuevo usa "reglas/RN-${rn.nextPadded}-<slug>.md".`,
    ];
    if (existing.length) {
      lines.push(
        "- Documentos numerados que YA existen. Si vas a ACTUALIZAR uno de estos, reutiliza su ruta EXACTA con accion \"upsert\" (no crees otro con otro nombre/número):",
        ...existing,
      );
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * Documenta una sesión EN EL ACTO: extrae los papers (decisiones/reglas/pantallas) de la conversación y
 * los persiste (disco + BD + índice; auto-maqueta las pantallas). Es la lógica del documenter expuesta
 * como FUNCIÓN, para usarla como TOOL que el chat invoca cuando se cierra algo que documentar (en vez de
 * correr el documenter como agente de fondo tras cada mensaje). Devuelve qué se guardó/borró.
 */
export async function documentSession(
  cfg: AppConfig, projectId: string, sessionId: string,
): Promise<{ saved: string[]; deleted: string[] }> {
  const res = await runDocumenter.run("chat-tool", projectId, { sessionId, triggerMessageId: "" }, cfg);
  const output = res.output as DocumenterOutput;
  await runDocumenter.apply("chat-tool", projectId, output);
  const ficheros = output.ficheros ?? [];
  return {
    saved: ficheros.filter((f) => f.accion !== "delete" && f.contenido?.trim()).map((f) => f.ruta),
    deleted: ficheros.filter((f) => f.accion === "delete").map((f) => f.ruta),
  };
}

export const runDocumenter = {
  async run(_runId: string, projectId: string, input: DocumenterInput, cfg: AppConfig) {
    const project = await getProject(projectId);
    const msgs = await buildDocContext(input.sessionId);
    if (msgs.length === 0) return { output: { ficheros: [] }, requiresGate: false };

    const transcript = msgs.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
    const numberingHint = await buildNumberingHint(project.rootPath);
    const system = await loadPrompt("documenter-system");

    // El documenter crea los papers (artefacto central): usa el rol `docs`, que se sirve con el
    // modelo principal (potente) → siempre disponible.
    const docsRole = "docs" as const;
    const res = await chat(
      cfg,
      docsRole,
      [
        { role: "system", content: system },
        {
          role: "user",
          content: `Proyecto: ${project.name}\nSessionId: ${input.sessionId}\n\n${numberingHint ? `${numberingHint}\n\n` : ""}Últimos mensajes:\n${transcript}\n\nDevuelve el JSON ahora.`,
        },
      ],
      { temperature: 0.1 },
      "documenter",
    );

    let parsed: DocumenterOutput;
    try {
      parsed = extractJson<DocumenterOutput>(res.content);
    } catch (e: any) {
      throw new Error(
        `validation_error: documenter no devolvió JSON válido (${e?.message ?? e}). Inicio: ${res.content.slice(0, 200)}`,
      );
    }

    parsed.ficheros = (parsed.ficheros ?? []).map((f) => ({
      ...f,
      ruta: safeRelPath(f.ruta ?? ""),
    })).filter((f) => f.ruta);

    return {
      output: parsed,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      modelRole: docsRole,
      modelName: res.model,
      requiresGate: false,
    };
  },

  async apply(runId: string, projectId: string, output: DocumenterOutput): Promise<void> {
    const cfg = await loadConfig();
    const project = await getProject(projectId);

    // Write conversation history JSON
    if (output.historial) {
      await appendHistory(project.rootPath, output.historial);
    }

    const ficheros = output.ficheros ?? [];
    console.log(`[documenter] apply runId=${runId} ficheros=${ficheros.length}`);

    // Escritura/borrado vía los escritores compartidos (disco + BD + índice). Las PANTALLAS pasan
    // SIEMPRE por el servicio único de pantallas (frontmatter + registro + maqueta auto), nunca a pelo.
    for (const f of ficheros) {
      if (!f.ruta) continue;
      try {
        const esPantalla = isScreenDoc(f.ruta);
        if (f.accion === "delete") {
          if (esPantalla) await deleteScreen(cfg, projectId, f.ruta);
          else await deleteProjectDocument(cfg, projectId, f.ruta);
        } else if (f.contenido?.trim()) {
          if (esPantalla) {
            // Auto-maqueta solo si falta (mockup: "auto" → no regenera si ya hay boceto).
            await saveScreenSpec(cfg, projectId, f.ruta, f.contenido, { mockup: "auto" });
          } else {
            await saveProjectDocument(cfg, projectId, {
              ruta: f.ruta,
              contenido: f.contenido,
              titulo: f.titulo,
              tags: f.tags,
              coleccion: f.coleccion,
              agentRunId: runId,
            });
          }
        }
      } catch (e) {
        log.warn("documenter", "no se pudo aplicar fichero", { err: e, ruta: f.ruta });
      }
    }
  },
};

async function appendHistory(
  rootPath: string,
  historial: { sessionId: string; turno: { usuario: string; asistente: string } },
): Promise<void> {
  const histDir = path.join(rootPath, "_historial");
  await fs.mkdir(histDir, { recursive: true });
  const filePath = path.join(histDir, `${historial.sessionId}.json`);
  let existing: any[] = [];
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {}
  existing.push({ ...historial.turno, ts: new Date().toISOString() });
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
}
