import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig, AppType } from "@shared";
import { chat } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { resolveProjectRoot } from "./mockup.js";
import { createScreen, regenerateMockup, screenExists, slugify, writeMap } from "../screens/service.js";
import { buildMapFromScreens } from "../screens/map.js";
import { log } from "../log.js";

/**
 * Agente "definir todas las pantallas": a partir de la documentación de negocio (reglas, dominios,
 * procesos, decisiones) enumera el conjunto COMPLETO de pantallas con su jerarquía (modales colgando
 * de su página) y crea los specs `pantallas/<slug>.md` con frontmatter (tipo/padre/orden). Las maquetas
 * se generan en segundo plano (no bloquean la respuesta): el árbol aparece al instante y los bocetos
 * se van poblando.
 */

const CONTEXT_DIRS = ["decisiones", "reglas", "dominios", "procesos", "aportados", "tecnicos"];
const CONTEXT_MAX_CHARS = 14000;

interface PlannedScreen {
  slug?: string;
  nombre?: string;
  tipo?: "pagina" | "modal";
  padre?: string | null;
  descripcion?: string;
  campos?: string[];
}

async function gatherContext(rootPath: string): Promise<string> {
  const parts: string[] = [];
  for (const dir of CONTEXT_DIRS) {
    const abs = path.join(rootPath, dir);
    let names: string[] = [];
    try {
      names = (await fs.readdir(abs)).filter((n) => n.toLowerCase().endsWith(".md") && !n.toLowerCase().endsWith(".fuente.md"));
    } catch { continue; }
    for (const name of names) {
      try {
        const body = await fs.readFile(path.join(abs, name), "utf-8");
        if (body.trim()) parts.push(`# [${dir}] ${name}\n${body.trim()}`);
      } catch { /* ignora un fichero suelto */ }
    }
  }
  let ctx = parts.join("\n\n---\n\n");
  if (ctx.length > CONTEXT_MAX_CHARS) ctx = ctx.slice(0, CONTEXT_MAX_CHARS) + "\n\n…(documentación recortada)";
  return ctx;
}

/** Extrae las pantallas de la respuesta del modelo. Tolera vallas ```json, texto alrededor, y que el
 *  modelo devuelva un OBJETO `{"pantallas":[...]}` o directamente un ARRAY `[...]`, con claves ES o EN. */
function parsePlan(raw: string): PlannedScreen[] {
  let s = (raw ?? "").trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();

  const tryParse = (text: string): any => { try { return JSON.parse(text); } catch { return null; } };
  let data = tryParse(s);
  if (data == null) {
    // Recorta al primer `{` o `[` (el que aparezca antes) y su cierre correspondiente.
    const objAt = s.indexOf("{");
    const arrAt = s.indexOf("[");
    let start = -1;
    let close = "";
    if (arrAt >= 0 && (objAt < 0 || arrAt < objAt)) { start = arrAt; close = "]"; }
    else if (objAt >= 0) { start = objAt; close = "}"; }
    if (start >= 0) {
      const end = s.lastIndexOf(close);
      if (end > start) data = tryParse(s.slice(start, end + 1));
    }
  }
  if (data == null) return [];

  const list = Array.isArray(data)
    ? data
    : Array.isArray(data.pantallas) ? data.pantallas
    : Array.isArray(data.screens) ? data.screens
    : Array.isArray(data.items) ? data.items
    : [];
  // Normaliza claves EN→ES por si el modelo las devuelve en inglés.
  return (Array.isArray(list) ? list : []).map((p: any) => ({
    slug: p.slug,
    nombre: p.nombre ?? p.name ?? p.title,
    tipo: (p.tipo ?? p.type) === "modal" ? "modal" : "pagina",
    padre: p.padre ?? p.parent ?? null,
    descripcion: p.descripcion ?? p.description ?? p.purpose,
    campos: p.campos ?? p.fields ?? p.elementos,
  }));
}

/** Cuerpo en prosa de la pantalla (sin frontmatter; el servicio se lo añade). */
function specBody(p: PlannedScreen): string {
  const nombre = (p.nombre ?? p.slug ?? "Pantalla").trim();
  const campos = (p.campos ?? []).map((c) => `- ${c}`).join("\n");
  return `# ${nombre}\n\n${(p.descripcion ?? "").trim()}\n\n## Campos y elementos\n${campos || "- (por definir)"}\n`;
}

export interface DefineScreensResult {
  created: number;
  skipped: number;
  total: number;
}

export async function defineScreens(cfg: AppConfig, projectId: string, appType: AppType): Promise<DefineScreensResult> {
  const rootPath = await resolveProjectRoot(projectId);
  const context = await gatherContext(rootPath);

  const system = await loadPrompt("screen-planner-system");
  const messages = [
    { role: "system" as const, content: system },
    { role: "system" as const, content: `Tipo de aplicación: ${appType}.` },
    {
      role: "user" as const,
      content: context.trim()
        ? `Documentación del negocio:\n\n${context}\n\nDevuelve el JSON con TODAS las pantallas.`
        : "Aún no hay apenas documentación. Propón el conjunto mínimo razonable de pantallas para este tipo de app. Devuelve el JSON.",
    },
  ];
  // Pide el JSON forzando `response_format: json_object` (lo soportan casi todos los proveedores). Si
  // alguno no lo admite y da error, reintenta sin forzarlo (el parser tolera texto/vallas igualmente).
  const ask = async (msgs: typeof messages, jsonMode: boolean) => {
    try {
      return await chat(cfg, "chat", msgs, { temperature: 0.3, maxTokens: 4000, jsonMode }, "screen-planner");
    } catch (e) {
      if (jsonMode) return chat(cfg, "chat", msgs, { temperature: 0.3, maxTokens: 4000 }, "screen-planner");
      throw e;
    }
  };

  const res = await ask(messages, true);
  let planned = parsePlan(res.content);

  // Reintento estricto: algunos modelos responden con prosa la 1ª vez. Le insistimos en SOLO JSON.
  if (planned.length === 0) {
    log.warn("screen-planner", "respuesta no parseable; reintento estricto", { muestra: (res.content ?? "").slice(0, 200) });
    const retry = await ask([
      { role: "system" as const, content: system },
      { role: "user" as const, content: (context.trim() ? `Documentación:\n\n${context}\n\n` : "") +
        'Responde EXCLUSIVAMENTE con el JSON `{"pantallas":[ ... ]}`. Nada de texto, explicaciones ni vallas de código. Empieza por `{`.' },
    ], true);
    planned = parsePlan(retry.content);
    if (planned.length === 0) {
      throw new Error(`el modelo no devolvió pantallas válidas. Empezó por: «${(retry.content ?? "").trim().slice(0, 120)}»`);
    }
  }

  let created = 0;
  let skipped = 0;
  const newRelPaths: string[] = [];
  let order = 0;
  for (const p of planned) {
    const name = (p.nombre ?? p.slug ?? "").trim();
    if (!name) continue;
    order += 10;
    // El servicio es la ÚNICA puerta: escribe el spec con frontmatter, lo registra en BD y lo indexa.
    if (await screenExists(projectId, slugify(name))) { skipped++; continue; }
    try {
      const r = await createScreen(cfg, projectId, {
        name,
        kind: p.tipo === "modal" ? "modal" : "pagina",
        parent: p.padre ?? null,
        body: specBody(p),
        order,
      });
      newRelPaths.push(r.path);
      created++;
    } catch (e) {
      log.warn("screen-planner", "no se pudo crear una pantalla", { err: e, name });
    }
  }

  // Escribe el MAPA (fuente de la estructura) a partir del plan, para que el árbol quede canónico.
  try {
    const mapInput = planned
      .map((p) => (p.nombre ?? p.slug ?? "").trim())
      .filter(Boolean)
      .map((nombre, i) => {
        const p = planned.find((x) => (x.nombre ?? x.slug ?? "").trim() === nombre)!;
        return {
          slug: slugify(nombre),
          name: nombre,
          kind: p.tipo === "modal" ? ("modal" as const) : ("pagina" as const),
          parent: p.tipo === "modal" && p.padre ? slugify(String(p.padre)) : null,
          order: i * 10,
        };
      });
    await writeMap(cfg, projectId, buildMapFromScreens(mapInput));
  } catch (e) {
    log.warn("screen-planner", "no se pudo escribir el mapa", { err: e });
  }

  // Maquetas en segundo plano: el árbol ya está; los bocetos se pueblan solos.
  void (async () => {
    for (const rel of newRelPaths) {
      try { await regenerateMockup(cfg, projectId, rel); }
      catch (e) { log.warn("screen-planner", "fallo generando maqueta", { err: e, rel }); }
    }
  })();

  return { created, skipped, total: planned.length };
}
