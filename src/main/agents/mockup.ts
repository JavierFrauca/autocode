import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import matter from "gray-matter";
import type { AppConfig, AppType } from "@shared";
import { chat, type ChatMessage, type ChatResult } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { log } from "../log.js";

/** Huella del CUERPO del spec (sin frontmatter). La maqueta sale del cuerpo; cambiar tipo/padre/orden
 *  NO debe marcarla como desactualizada. La maqueta lleva embebida la huella con la que se generó. */
export function specBodyHash(spec: string): string {
  let body = spec;
  try { body = matter(spec).content; } catch { /* sin frontmatter: usa el texto tal cual */ }
  return createHash("sha256").update(body.trim()).digest("hex").slice(0, 16);
}
const HASH_RE = /<!--\s*spec-hash:\s*([a-f0-9]+)\s*-->/i;

/**
 * Maquetador: genera un BOCETO HTML por pantalla (`pantallas/<slug>.preview.html`) a partir de la
 * prosa del spec (`pantallas/<slug>.md`). La maqueta es un ARTEFACTO adjunto, NO un documento: no se
 * guarda en `document_revisions`, no se versiona y NO se embebe en Qdrant (el índice solo come `.md`
 * dentro de DOC_DIRS, ver `papers/ingest.ts`). El spec en prosa sigue siendo la única fuente de
 * verdad; la maqueta es una vista regenerable que el usuario refina (botón) y el builder consulta
 * como referencia visual (tool `leer_maqueta`).
 */

const SCREEN_DIR = "pantallas";
const MOCKUP_MAX_TOKENS = 6000;
// Umbral para NO auto-generar desde un stub recién creado ("# Título\n\n"): solo merece maqueta un
// spec con algo de contenido. Bajo a propósito (separa un stub ~0 de un spec real); el botón (force)
// se salta este guard de todos modos.
const MIN_SPEC_CHARS = 40;

/** ¿Es un documento de pantalla (`pantallas/*.md`)? Los `_*` (p.ej. `_mapa.md`) NO son pantallas. */
export function isScreenDoc(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p.startsWith(`${SCREEN_DIR}/`) || !p.toLowerCase().endsWith(".md")) return false;
  const base = p.split("/").pop() ?? "";
  return !base.startsWith("_") && !base.toLowerCase().endsWith(".fuente.md");
}

/** Ruta del sibling de maqueta: `pantallas/x.md` → `pantallas/x.preview.html`. */
export function mockupPathFor(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/\.md$/i, ".preview.html");
}

/** ¿La maqueta está desactualizada respecto al CUERPO del spec? Compara la huella embebida en la maqueta
 *  con la del cuerpo actual. Una maqueta antigua sin huella (o un write-back del builder) NO se marca. */
export async function isMockupStale(rootPath: string, relPath: string): Promise<boolean> {
  const mdAbs = path.resolve(rootPath, relPath);
  const htmlAbs = path.resolve(rootPath, mockupPathFor(relPath));
  try {
    const [spec, html] = await Promise.all([fs.readFile(mdAbs, "utf-8"), fs.readFile(htmlAbs, "utf-8")]);
    const m = html.match(HASH_RE);
    if (!m) return false; // sin huella → no molestamos (se pondrá al regenerar)
    return m[1] !== specBodyHash(spec);
  } catch {
    return false; // falta alguno → no aplica "desactualizada"
  }
}

/** Quita fences ```html … ``` y cualquier texto antes del `<!doctype>`/`<html>`. */
export function stripHtmlFences(raw: string): string {
  let s = (raw ?? "").trim();
  const fence = s.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/i);
  if (fence?.[1]) s = fence[1].trim();
  // Si el modelo añadió texto ANTES del documento, recorta hasta el inicio real del HTML. Solo si el
  // inicio está desplazado (>0): si ya empieza en <!doctype>/<html>, no tocar (no comerse el doctype).
  const lower = s.toLowerCase();
  const starts = [lower.indexOf("<!doctype"), lower.indexOf("<html")].filter((i) => i >= 0);
  if (starts.length) {
    const start = Math.min(...starts);
    if (start > 0) s = s.slice(start);
  }
  return s.trim();
}

/** ¿El spec tiene contenido suficiente para merecer una maqueta automática? */
function hasSubstantialSpec(spec: string): boolean {
  const body = spec.replace(/^#.*$/m, ""); // descarta la línea del título H1
  return body.replace(/\s+/g, " ").trim().length >= MIN_SPEC_CHARS;
}

// Tipo estrecho para la costura de test: solo necesitamos `content` del resultado. El `chat` real
// (que devuelve ChatResult) es asignable a esto.
type MockupChatFn = (
  cfg: AppConfig,
  role: any,
  messages: ChatMessage[],
  opts?: any,
  source?: string,
) => Promise<Pick<ChatResult, "content">>;

export interface MockupDeps {
  chatFn?: MockupChatFn;
  resolveRootPath?: (projectId: string) => Promise<string>;
  systemPrompt?: string; // costura de test: evita loadPrompt (que toca electron.app)
}

// Resolución por defecto del rootPath del proyecto. Import perezoso de `db/client` (arrastra el
// nativo `better-sqlite3`) para no tocarlo al cargar el módulo ni en los tests bajo node.
// Exportada porque la tool `leer_maqueta` del builder la reutiliza.
export async function resolveProjectRoot(projectId: string): Promise<string> {
  const { db, schema } = await import("../db/client.js");
  const { eq } = await import("drizzle-orm");
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!rows[0]) throw new Error(`Proyecto ${projectId} no encontrado`);
  return rows[0].rootPath;
}

/**
 * Paleta EXACTA según el tipo de app, para que el boceto se parezca al andamiaje real del que partirá
 * el builder: ESCRITORIO (electron) = tema slate oscuro (`templates/electron-app`); WEB (server) = tema
 * claro (`templates/server-app`). Se inyecta como system aparte para no duplicar el prompt base.
 */
export function paletteBlock(appType: AppType): string {
  if (appType === "server") {
    return [
      '## Paleta EXACTA a usar (tema CLARO — la app web se ve así). No inventes otros colores:',
      "- Fondo de página: #f5f7fb",
      "- Superficie / tarjetas: #ffffff",
      "- Bordes: #e7ecf3",
      "- Texto principal: #0f172a",
      "- Texto secundario / atenuado: #64748b",
      "- Acento (títulos, botones primarios, enlaces, foco): #4f46e5",
      '- Tipografía: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      "- Esquinas redondeadas: 14px en tarjetas, 9px en controles",
      "- Pills/badges: fondo #eef0fe, texto #4f46e5, border-radius 999px",
      "- Botones primarios: fondo #4f46e5 con texto #ffffff; secundarios: transparentes con borde #cbd5e1",
      "- Añade `:root { color-scheme: light; }`",
    ].join("\n");
  }
  // electron (escritorio) y por defecto: tema slate oscuro.
  return [
    '## Paleta EXACTA a usar (tema OSCURO "slate" — la app de escritorio se ve así). No inventes otros colores:',
    "- Fondo de página: #0f172a",
    "- Superficie / tarjetas: #1e293b",
    "- Bordes: #334155",
    "- Texto principal: #e2e8f0",
    "- Texto secundario / atenuado: #94a3b8",
    "- Acento (títulos, botones primarios, enlaces, foco): #38bdf8",
    '- Tipografía: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "- Esquinas redondeadas: 12px en tarjetas, 8px en controles pequeños",
    "- Pills/badges: fondo #1e293b, borde #334155, border-radius 999px",
    "- Botones primarios: fondo #38bdf8 con texto oscuro #0f172a; secundarios: transparentes con borde #334155",
  ].join("\n");
}

/**
 * Genera el HTML de la maqueta desde la prosa del spec (sin tocar disco).
 * Si `tweak` viene, MODIFICA el boceto actual según la instrucción del usuario ("sube el botón",
 * "quita la columna de fecha"…) conservando el resto del diseño, en vez de rehacerlo desde el spec.
 */
export async function generateMockupHtml(
  cfg: AppConfig,
  spec: string,
  appType: AppType = "electron",
  deps: MockupDeps = {},
  tweak?: { instruction: string; currentHtml?: string },
): Promise<string> {
  const chatFn = deps.chatFn ?? (chat as MockupChatFn);
  const system = deps.systemPrompt ?? (await loadPrompt("mockup-system"));
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "system", content: paletteBlock(appType) },
  ];
  if (tweak?.instruction) {
    messages.push({
      role: "user",
      content:
        `Especificación de la pantalla (Markdown):\n\n${spec}\n\n` +
        (tweak.currentHtml ? `Boceto ACTUAL (HTML):\n\n${tweak.currentHtml}\n\n` : "") +
        `Aplica este cambio que pide el usuario, conservando el resto del diseño y la paleta:\n` +
        `"${tweak.instruction}"\n\nDevuelve SOLO el HTML del boceto ya modificado.`,
    });
  } else {
    messages.push({
      role: "user",
      content: `Especificación de la pantalla (Markdown):\n\n${spec}\n\nDevuelve SOLO el HTML del boceto.`,
    });
  }
  const res = await chatFn(cfg, "docs", messages, { temperature: 0.3, maxTokens: MOCKUP_MAX_TOKENS }, "mockup");
  return stripHtmlFences(res.content);
}

export interface EnsureMockupResult {
  status: "generated" | "skipped" | "not-screen";
  path?: string;
}

/**
 * Asegura la maqueta de una pantalla.
 * - `force:false` (auto): no-op si no es pantalla / spec pobre / la maqueta ya existe.
 * - `force:true` (botón): regenera siempre desde el spec actual.
 */
export async function ensureMockupForScreen(
  cfg: AppConfig,
  projectId: string,
  relPath: string,
  opts: { force?: boolean; appType?: AppType; instruction?: string } = {},
  deps: MockupDeps = {},
): Promise<EnsureMockupResult> {
  if (!isScreenDoc(relPath)) return { status: "not-screen" };

  const resolveRoot = deps.resolveRootPath ?? resolveProjectRoot;
  const rootPath = await resolveRoot(projectId);

  const mdAbs = path.resolve(rootPath, relPath);
  const htmlRel = mockupPathFor(relPath);
  const htmlAbs = path.resolve(rootPath, htmlRel);

  // Anti path-traversal: la maqueta debe quedar dentro del proyecto.
  const rootNorm = path.resolve(rootPath).toLowerCase();
  if (!htmlAbs.toLowerCase().startsWith(rootNorm)) return { status: "not-screen" };

  // Una instrucción ("modificar con IA") implica regenerar siempre sobre el boceto actual.
  const force = opts.force || !!opts.instruction;

  if (!force) {
    try {
      await fs.access(htmlAbs);
      return { status: "skipped", path: htmlRel }; // ya existe → no regenerar en auto
    } catch { /* no existe: seguimos */ }
  }

  let spec = "";
  try {
    spec = await fs.readFile(mdAbs, "utf-8");
  } catch {
    return { status: "not-screen" }; // el .md no existe (p.ej. borrado): nada que maquetar
  }
  if (!force && !hasSubstantialSpec(spec)) {
    return { status: "skipped", path: htmlRel }; // stub vacío: no malgastar LLM
  }
  if (!spec.trim()) return { status: "not-screen" };

  // Para modificar, partimos del boceto actual (si existe) y le aplicamos el cambio pedido.
  const tweak = opts.instruction
    ? { instruction: opts.instruction, currentHtml: await fs.readFile(htmlAbs, "utf-8").catch(() => undefined) }
    : undefined;

  let html: string;
  try {
    html = await generateMockupHtml(cfg, spec, opts.appType ?? "electron", deps, tweak);
  } catch (e) {
    log.warn("mockup", "fallo generando la maqueta", { err: e, ruta: relPath });
    return { status: "skipped", path: htmlRel };
  }
  if (!html.trim()) {
    log.warn("mockup", "el modelo no devolvió HTML", { ruta: relPath });
    return { status: "skipped", path: htmlRel };
  }

  await fs.mkdir(path.dirname(htmlAbs), { recursive: true });
  // Embebe la huella del cuerpo del spec para detectar "desactualizada" sin depender de fechas.
  await fs.writeFile(htmlAbs, `${html}\n<!-- spec-hash: ${specBodyHash(spec)} -->\n`, "utf-8");
  log.info("mockup", "maqueta generada", { ruta: htmlRel });
  return { status: "generated", path: htmlRel };
}

/**
 * Asegura la maqueta de TODAS las pantallas del proyecto (`pantallas/*.md`) ANTES de construir, para que
 * el builder PARTA de la maqueta de cada pantalla (no la diseñe desde cero). Idempotente: solo genera las
 * que faltan (`force:false`). Devuelve cuántas pantallas hay y cuántas maquetas se generaron en esta pasada.
 */
export async function ensureMockupsForScreens(
  cfg: AppConfig,
  projectId: string,
  appType: AppType,
  deps: MockupDeps = {},
): Promise<{ total: number; generated: number }> {
  const resolveRoot = deps.resolveRootPath ?? resolveProjectRoot;
  const rootPath = await resolveRoot(projectId);
  const dir = path.join(rootPath, SCREEN_DIR);
  let names: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .map((e) => `${SCREEN_DIR}/${e.name}`);
  } catch {
    return { total: 0, generated: 0 }; // aún no hay carpeta de pantallas
  }
  let generated = 0;
  for (const rel of names) {
    try {
      const r = await ensureMockupForScreen(cfg, projectId, rel, { force: false, appType }, deps);
      if (r.status === "generated") generated++;
    } catch (e) {
      log.warn("mockup", "no se pudo asegurar la maqueta de una pantalla", { err: e, ruta: rel });
    }
  }
  return { total: names.length, generated };
}
