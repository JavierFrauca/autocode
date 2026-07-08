import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AppConfig, AppType } from "@shared";
import { chat } from "../llm/client.js";
import { saveProjectDocument, deleteProjectDocument } from "../papers/save.js";
import { ensureMockupForScreen, isMockupStale, mockupPathFor, resolveProjectRoot, specBodyHash, stripHtmlFences } from "../agents/mockup.js";
import { getArchitecture } from "../architecture.js";
import { ensureScreenFrontmatter, newScreenContent, readScreenMeta, screenSlug, writeScreenMeta, type ScreenKind } from "./meta.js";
import { MAP_REL, buildMapFromScreens, flattenMap, parseMap, serializeMap, type MapNode } from "./map.js";

/**
 * SERVICIO DE PANTALLAS — la ÚNICA puerta para crear/guardar/mover/borrar/regenerar una pantalla.
 * Toda mutación (UI REST, screen-planner, "modificar con IA", write-back del builder, documenter) pasa
 * por aquí, así que SIEMPRE ocurre lo mismo: el spec se escribe vía `saveProjectDocument` (disco + tabla
 * documents + revisión + índice Nucleus), con su frontmatter de jerarquía (tipo/padre/orden), y la
 * maqueta se genera por `ensureMockupForScreen`. Una implementación, todos los consumidores.
 */

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function appTypeOf(projectId: string): Promise<AppType> {
  return (await getArchitecture(projectId))?.appType ?? "electron";
}

export interface ScreenInfo {
  path: string; slug: string; name: string;
  kind: ScreenKind; parent: string | null; order: number;
  mockupExists: boolean; stale: boolean; html: string | null;
}

/** Lista todas las pantallas con su jerarquía y su maqueta. */
export async function listScreens(projectId: string): Promise<{ screens: ScreenInfo[] }> {
  const rootPath = await resolveProjectRoot(projectId);
  const dir = path.join(rootPath, "pantallas");
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir))
      .filter((n) => n.toLowerCase().endsWith(".md") && !n.toLowerCase().endsWith(".fuente.md") && !n.startsWith("_"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return { screens: [] };
  }
  const screens = await Promise.all(names.map(async (name): Promise<ScreenInfo> => {
    const relPath = `pantallas/${name}`;
    const [spec, html] = await Promise.all([
      fs.readFile(path.resolve(rootPath, relPath), "utf-8").catch(() => ""),
      fs.readFile(path.resolve(rootPath, mockupPathFor(relPath)), "utf-8").catch(() => null),
    ]);
    const meta = readScreenMeta(spec);
    const stale = html ? await isMockupStale(rootPath, relPath) : false;
    return {
      path: relPath, slug: screenSlug(relPath),
      name: name.replace(/\.md$/i, "").replace(/-/g, " "),
      kind: meta.kind, parent: meta.parent, order: meta.order,
      mockupExists: !!html, stale, html,
    };
  }));
  return { screens };
}

export interface CreateScreenInput {
  name: string;
  kind?: ScreenKind;
  parent?: string | null;
  /** Cuerpo en prosa (sin frontmatter). Si falta, se crea un stub `# Nombre`. */
  body?: string;
  order?: number;
}

/** ¿Existe ya esa pantalla (por slug)? */
export async function screenExists(projectId: string, slug: string): Promise<boolean> {
  const rootPath = await resolveProjectRoot(projectId);
  return fs.access(path.resolve(rootPath, `pantallas/${slug}.md`)).then(() => true).catch(() => false);
}

/** Crea una pantalla (página o modal). Escribe el spec con frontmatter; NO genera la maqueta (el llamante
 *  decide cuándo con `regenerateMockup`). Lanza si ya existe. */
export async function createScreen(cfg: AppConfig, projectId: string, input: CreateScreenInput): Promise<{ path: string; slug: string; name: string; kind: ScreenKind; parent: string | null }> {
  const name = input.name.trim();
  const slug = slugify(name) || `pantalla-${Date.now()}`;
  if (await screenExists(projectId, slug)) throw new Error("ya existe una pantalla con ese nombre");
  const relPath = `pantallas/${slug}.md`;
  const kind: ScreenKind = input.kind === "modal" ? "modal" : "pagina";
  const parent = kind === "modal" && input.parent ? slugify(String(input.parent)) : null;
  const order = input.order ?? (Date.now() % 100000);
  const content = input.body?.trim()
    ? matter.stringify(`${input.body.trim()}\n`, parent ? { tipo: kind, padre: parent, orden: order } : { tipo: kind, orden: order })
    : newScreenContent(name, { kind, parent, order });
  await saveProjectDocument(cfg, projectId, { ruta: relPath, contenido: content, titulo: name });
  return { path: relPath, slug, name, kind, parent };
}

/** Guarda el spec (lo normaliza con frontmatter) por el camino canónico y regenera la maqueta. */
export async function saveScreenSpec(
  cfg: AppConfig, projectId: string, relPath: string, content: string,
  opts: { mockup?: "auto" | "force" | "none" } = {},
): Promise<{ html: string | null }> {
  await saveProjectDocument(cfg, projectId, { ruta: relPath, contenido: ensureScreenFrontmatter(content) });
  const mode = opts.mockup ?? "force";
  if (mode === "none") return { html: null };
  const appType = await appTypeOf(projectId);
  const r = await ensureMockupForScreen(cfg, projectId, relPath, { force: mode === "force", appType });
  if (r.status !== "generated" || !r.path) return { html: null };
  const rootPath = await resolveProjectRoot(projectId);
  const html = await fs.readFile(path.resolve(rootPath, r.path), "utf-8").catch(() => null);
  return { html };
}

/** Cambia tipo/padre/orden (frontmatter), preservando el cuerpo, por el camino canónico. */
export async function setScreenMeta(cfg: AppConfig, projectId: string, relPath: string, meta: { kind?: ScreenKind; parent?: string | null; order?: number }): Promise<void> {
  const rootPath = await resolveProjectRoot(projectId);
  const spec = await fs.readFile(path.resolve(rootPath, relPath), "utf-8");
  // Solo cambia el frontmatter (no el cuerpo) → la maqueta sigue vigente. La "desactualización" se mide
  // por la huella del CUERPO embebida en la maqueta (ver mockup.isMockupStale), no por fechas.
  await saveProjectDocument(cfg, projectId, { ruta: relPath, contenido: writeScreenMeta(spec, meta) });
}

/** Borra una pantalla: spec (disco + BD + índice) y su maqueta. */
export async function deleteScreen(cfg: AppConfig, projectId: string, relPath: string): Promise<void> {
  await deleteProjectDocument(cfg, projectId, relPath);
  const rootPath = await resolveProjectRoot(projectId);
  await fs.rm(path.resolve(rootPath, mockupPathFor(relPath)), { force: true }).catch(() => { /* puede no existir */ });
}

/** Regenera la maqueta desde el spec actual. */
export async function regenerateMockup(cfg: AppConfig, projectId: string, relPath: string): Promise<{ html: string | null }> {
  const appType = await appTypeOf(projectId);
  const r = await ensureMockupForScreen(cfg, projectId, relPath, { force: true, appType });
  if (r.status !== "generated") throw new Error("no se pudo generar la maqueta");
  const rootPath = await resolveProjectRoot(projectId);
  const html = await fs.readFile(path.resolve(rootPath, r.path!), "utf-8").catch(() => null);
  return { html };
}

/**
 * Entrada de historial para una actualización MANUAL de maqueta (`actualizar_maqueta`): archiva la
 * versión anterior con su motivo y fecha, en vez de perderla en una sobrescritura silenciosa.
 */
export function formatMockupHistoryEntry(motivo: string, timestamp: string, previousHtml: string): string {
  return `## ${timestamp}\n\n**Motivo:** ${motivo.trim()}\n\n\`\`\`html\n${previousHtml.trim()}\n\`\`\`\n\n`;
}

/** Ruta del historial de maqueta (`pantallas/x.md` → `pantallas/x.preview.historial.md`). */
export function mockupHistoryPathFor(relPath: string): string {
  return mockupPathFor(relPath).replace(/\.preview\.html$/i, ".preview.historial.md");
}

/**
 * Write-back del builder: fija el HTML de la maqueta (reflejo fiel de lo construido). El `motivo` es
 * OBLIGATORIO (lo exige ya el schema de la tool `actualizar_maqueta`): antes de sobrescribir, archiva la
 * maqueta anterior + motivo + fecha en un historial legible, y reinserta la huella (`spec-hash`) del spec
 * actual para que `isMockupStale` siga detectando cambios futuros del spec sobre esta misma maqueta.
 */
export async function setMockupHtml(projectId: string, relPath: string, html: string, motivo: string): Promise<void> {
  const rootPath = await resolveProjectRoot(projectId);
  const abs = path.resolve(rootPath, mockupPathFor(relPath));
  if (!abs.toLowerCase().startsWith(path.resolve(rootPath).toLowerCase())) throw new Error("ruta inválida");

  const previous = await fs.readFile(abs, "utf-8").catch(() => null);
  if (previous) {
    const historyAbs = path.resolve(rootPath, mockupHistoryPathFor(relPath));
    const entry = formatMockupHistoryEntry(motivo, new Date().toISOString(), previous);
    await fs.appendFile(historyAbs, entry, "utf-8").catch(() => {});
  }

  let hashComment = "";
  const specAbs = path.resolve(rootPath, relPath);
  try {
    const spec = await fs.readFile(specAbs, "utf-8");
    hashComment = `\n<!-- spec-hash: ${specBodyHash(spec)} -->\n`;
  } catch { /* sin spec legible: se queda sin huella, como cuando no existe */ }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${stripHtmlFences(html)}${hashComment}`, "utf-8");
}

/** Quita vallas ```markdown … ``` si el modelo las añade. */
function stripMdFence(raw: string): string {
  const s = (raw ?? "").trim();
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (m?.[1] ?? s).trim();
}

/** Aplica con IA un cambio en lenguaje natural sobre la especificación (Markdown). */
async function editSpecWithAi(cfg: AppConfig, spec: string, instruction: string): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content:
        "Eres un editor de especificaciones de pantalla en Markdown. Aplica EXACTAMENTE el cambio que " +
        "pide el usuario sobre la especificación dada, conservando el resto del contenido, el estilo y la " +
        "estructura. No añadas comentarios ni explicaciones. Devuelve SOLO el Markdown completo ya actualizado.",
    },
    {
      role: "user" as const,
      content:
        `Especificación actual:\n\n${spec}\n\nCambio a aplicar:\n"${instruction}"\n\n` +
        "Devuelve la especificación completa ya modificada (solo Markdown, sin vallas de código).",
    },
  ];
  const res = await chat(cfg, "chat", messages, { temperature: 0.2, maxTokens: 4000 }, "screen-modify");
  return stripMdFence(res.content);
}

/** "Modificar con IA" coherente: edita el spec con el modelo y regenera la maqueta. */
export async function modifyScreenWithAi(cfg: AppConfig, projectId: string, relPath: string, instruction: string): Promise<{ spec: string; html: string | null }> {
  const rootPath = await resolveProjectRoot(projectId);
  const spec = await fs.readFile(path.resolve(rootPath, relPath), "utf-8");
  const newSpec = await editSpecWithAi(cfg, spec, instruction.trim());
  if (!newSpec.trim()) throw new Error("la IA devolvió una especificación vacía");
  const { html } = await saveScreenSpec(cfg, projectId, relPath, newSpec, { mockup: "force" });
  return { spec: newSpec, html };
}

// ── MAPA de pantallas (fuente única de la estructura) ─────────────────────────────────────────────

/** Lee el árbol del mapa. Si aún no hay `_mapa.md`, lo deriva de las pantallas existentes (migración). */
export async function readMap(projectId: string): Promise<MapNode[]> {
  const rootPath = await resolveProjectRoot(projectId);
  const md = await fs.readFile(path.resolve(rootPath, MAP_REL), "utf-8").catch(() => null);
  if (md && md.trim()) return parseMap(md);
  const { screens } = await listScreens(projectId);
  return buildMapFromScreens(screens);
}

/** Escribe el mapa (vía saveProjectDocument → disco + BD + índice). */
export async function writeMap(cfg: AppConfig, projectId: string, nodes: MapNode[]): Promise<void> {
  await saveProjectDocument(cfg, projectId, { ruta: MAP_REL, contenido: serializeMap(nodes), titulo: "Mapa de pantallas" });
}

export interface MaterializeResult { created: number; updated: number; orphans: string[] }

/** Materializa el mapa → pantallas (ESTRUCTURAL, sin maquetas): crea las que falten (stub), estampa la
 *  jerarquía a todas desde el mapa y, opcionalmente, borra las huérfanas (las que ya no están en el mapa).
 *  Las maquetas se generan aparte con `generateAllMockups` (acción "Generar todas las maquetas"). */
export async function materializeMap(cfg: AppConfig, projectId: string, opts: { deleteOrphans?: boolean } = {}): Promise<MaterializeResult> {
  const flat = flattenMap(await readMap(projectId));
  const { screens } = await listScreens(projectId);
  const bySlug = new Map(screens.map((s) => [s.slug, s]));
  let created = 0;
  let updated = 0;
  for (const f of flat) {
    const existing = bySlug.get(f.slug);
    if (existing) {
      // Solo reescribe si la jerarquía cambió de verdad (evita churn y falsos "desactualizada").
      if (existing.kind !== f.kind || existing.parent !== f.parent || existing.order !== f.order) {
        await setScreenMeta(cfg, projectId, existing.path, { kind: f.kind, parent: f.parent, order: f.order });
        updated++;
      }
    } else {
      await createScreen(cfg, projectId, { name: f.name, kind: f.kind, parent: f.parent, order: f.order });
      created++;
    }
  }
  const inMap = new Set(flat.map((f) => f.slug));
  const orphanScreens = screens.filter((s) => !inMap.has(s.slug));
  if (opts.deleteOrphans) {
    for (const s of orphanScreens) { try { await deleteScreen(cfg, projectId, s.path); } catch { /* sigue */ } }
  }
  return { created, updated, orphans: orphanScreens.map((s) => s.path) };
}

/** "Generar todas las maquetas": materializa el mapa y genera (en 2º plano) la maqueta de CADA pantalla
 *  que aún no la tenga. Una sola acción → todas las pantallas dibujadas, también las que faltaban. */
export async function generateAllMockups(cfg: AppConfig, projectId: string): Promise<{ total: number; generating: number }> {
  await materializeMap(cfg, projectId, { deleteOrphans: false });
  const { screens } = await listScreens(projectId);
  const missing = screens.filter((s) => !s.mockupExists);
  void (async () => {
    for (const s of missing) { try { await regenerateMockup(cfg, projectId, s.path); } catch { /* sigue con la siguiente */ } }
  })();
  return { total: screens.length, generating: missing.length };
}

/** Guarda un árbol editado en la UI: escribe el mapa y materializa (borrando huérfanas). */
export async function saveMap(cfg: AppConfig, projectId: string, nodes: MapNode[]): Promise<MaterializeResult> {
  await writeMap(cfg, projectId, nodes);
  return materializeMap(cfg, projectId, { deleteOrphans: true });
}

/** Árbol del mapa para la UI, con el estado de cada nodo (si está materializado y su maqueta). */
export async function mapWithStatus(projectId: string): Promise<{ tree: MapNode[]; status: Record<string, { hasScreen: boolean; mockupExists: boolean; stale: boolean; path: string }> }> {
  const tree = await readMap(projectId);
  const { screens } = await listScreens(projectId);
  const status: Record<string, { hasScreen: boolean; mockupExists: boolean; stale: boolean; path: string }> = {};
  for (const s of screens) status[s.slug] = { hasScreen: true, mockupExists: s.mockupExists, stale: s.stale, path: s.path };
  return { tree, status };
}
