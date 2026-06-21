import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import { db, schema } from "./db/client.js";
import { loadConfig } from "./config.js";
import { ingestRevision } from "./papers/ingest.js";
import { chat } from "./llm/client.js";
import { saveProjectDocument } from "./papers/save.js";
import { nextDocNumberInDir } from "./papers/numbering.js";
import { loadPrompt } from "./prompts.js";
import {
  composeTechnicalPaper,
  technicalDocPaths,
  TECH_DIR,
  TECH_PREFIX,
  TECH_RAW_CAP,
} from "./attachments-tecnico.js";
import { log } from "./log.js";

/**
 * Adjuntos del chat. Clasifica por tipo de fichero (la conversación es el matiz, el tipo manda):
 *  - imágenes/gráficos → RECURSOS (carpeta media/, assets que el coder usa en la UI),
 *  - texto/estructurado/PDF/docx/URL → DOCUMENTOS de referencia aportada (`aportados/DOC-*.md`),
 *    ingestados a Qdrant → consultables por el chat (RAG), el MCP y el corpus del planner/coder.
 */

export { classify, extractText, type AttachKind } from "./attachments-extract.js";

const REFERENCE_DIR = "aportados";

function slug(s: string): string {
  return (
    s.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "doc"
  );
}

function safeName(raw: string): string {
  return path.basename(raw).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}

async function projectRow(projectId: string) {
  const r = (
    await db()
      .select({ rootPath: schema.projects.rootPath, c: schema.projects.qdrantCollection })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1)
  )[0];
  if (!r) throw new Error("proyecto no encontrado");
  return r;
}

/** Guarda un recurso gráfico en media/ (mismo destino que la pestaña Recursos). */
export async function saveResource(projectId: string, filename: string, buffer: Buffer): Promise<{ name: string; projectPath: string }> {
  const { rootPath } = await projectRow(projectId);
  const dir = path.join(rootPath, "media");
  await fs.mkdir(dir, { recursive: true });
  const name = safeName(filename);
  await fs.writeFile(path.join(dir, name), buffer);
  return { name, projectPath: `media/${name}` };
}

/** Guarda un documento de REFERENCIA aportado por el usuario (DOC-) + lo ingesta a Qdrant. */
export async function saveReferenceDoc(opts: {
  projectId: string;
  name: string;
  body: string;
  source?: string;
}): Promise<{ path: string; title: string }> {
  const { rootPath, c } = await projectRow(opts.projectId);
  const title = `DOC-${opts.name}`.slice(0, 180);
  const relPath = `${REFERENCE_DIR}/DOC-${slug(opts.name)}.md`;

  const front = [
    "---",
    "tipo: referencia aportada por el usuario",
    opts.source ? `origen: ${opts.source}` : null,
    `fecha: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${title}`,
    "",
  ].filter(Boolean).join("\n");
  const fullBody = front + opts.body.trim() + "\n";

  const abs = path.join(rootPath, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, fullBody, "utf-8");

  const existing = (
    await db().select({ id: schema.documents.id }).from(schema.documents)
      .where(and(eq(schema.documents.projectId, opts.projectId), eq(schema.documents.path, relPath))).limit(1)
  )[0];
  let docId: string;
  if (existing) {
    docId = existing.id;
    await db().update(schema.documents)
      .set({ title, tags: ["aportado", "referencia"], deletedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, docId));
  } else {
    docId = `doc_${ulid().toLowerCase()}`;
    await db().insert(schema.documents).values({
      id: docId, projectId: opts.projectId, path: relPath, title, tags: ["aportado", "referencia"], status: "active",
    });
  }
  const revId = `rev_${ulid().toLowerCase()}`;
  await db().insert(schema.documentRevisions).values({
    id: revId, documentId: docId, projectId: opts.projectId, body: fullBody, authorRole: "user",
  });

  try {
    const cfg = await loadConfig();
    await ingestRevision(cfg, opts.projectId, c, docId, revId, relPath, title, fullBody);
  } catch (e) {
    log.warn("attachments", "no se pudo indexar el documento aportado en Qdrant", { err: e });
  }
  return { path: relPath, title };
}

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Descarga una URL pública y la convierte a markdown legible. Guardrail SSRF mínimo. */
export async function fetchUrlAsMarkdown(url: string): Promise<{ title: string; markdown: string }> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("la dirección no es válida"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("solo se admiten enlaces http/https");
  if (PRIVATE_HOST.test(u.hostname)) throw new Error("no se permiten direcciones locales o privadas");

  const res = await fetch(u.toString(), {
    headers: { "user-agent": "AutoCode/0.1 (+https://autocode.local)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`la página respondió con error ${res.status}`);
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? u.hostname).trim().slice(0, 120);

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(nav|header|footer|aside|noscript|svg)[\s\S]*?<\/\1>/gi, "");
  const TurndownService = (await import("turndown")).default;
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  const markdown = td.turndown(cleaned).replace(/\n{3,}/g, "\n\n").trim().slice(0, 60_000);
  return { title, markdown };
}

/** Saca "conclusiones" en markdown de un contenido con el LLM. Best-effort: si falla, null. */
export async function summarizeConclusions(cfg: AppConfig, source: string, content: string): Promise<string | null> {
  if (!cfg.generation.mainModel) return null;
  const role = "docs" as const;
  try {
    const res = await chat(
      cfg, role,
      [
        { role: "system", content: "Resume el contenido en markdown claro y breve: una sección '## Conclusiones' con los puntos clave que un desarrollador debería recordar. Sin relleno, en el idioma del contenido." },
        { role: "user", content: `Fuente: ${source}\n\nContenido:\n${content.slice(0, 12_000)}` },
      ],
      { temperature: 0.2, maxTokens: 1200 },
      "attach-summary",
    );
    return res.content.trim() || null;
  } catch (e) {
    log.warn("attachments", "no se pudo resumir la URL", { err: e });
    return null;
  }
}

// ── Documentos técnicos (fuentes canónicas destiladas a paper) ───────────────────────────────────
//
// Cuando una regla de negocio depende de una especificación exacta (formato de fichero, norma, esquema
// oficial, API de un tercero), el chat NO improvisa de memoria: pide la fuente y la registra aquí. La
// fuente se canoniza, se DESTILA a un paper técnico citable e indexado (`tecnicos/DT-NNN-*.md`) y la
// cruda se conserva como hermano `*.fuente.md` (artefacto NO indexado, recuperable).

export interface TechnicalDocResult {
  /** Paper técnico indexado, p.ej. `tecnicos/DT-001-formato-cotizacion.md`. */
  path: string;
  /** Fuente cruda guardada como artefacto NO indexado (hermano `*.fuente.md`). */
  sourcePath: string;
  title: string;
  /** Número con relleno, p.ej. "001". */
  number: string;
}

export interface TechnicalDocDeps {
  chatFn?: typeof chat;
  loadPromptFn?: (name: string) => Promise<string>;
  now?: () => Date;
}

/**
 * Destila la fuente cruda en el cuerpo de un paper técnico con el LLM (rol `docs`). Best-effort: si el
 * modelo falla o no hay modelo, NO perdemos la fuente — la envolvemos tal cual como paper mínimo.
 */
export async function buildTechnicalPaper(
  cfg: AppConfig,
  opts: { source: string; rawMarkdown: string; tema?: string; title: string },
  deps: TechnicalDocDeps = {},
): Promise<string> {
  const chatFn = deps.chatFn ?? chat;
  const loadPromptFn = deps.loadPromptFn ?? loadPrompt;
  const raw = opts.rawMarkdown.trim();
  const fechaISO = (deps.now?.() ?? new Date()).toISOString();
  let paperBody = "";

  if (cfg.generation.mainModel && raw) {
    try {
      const system = await loadPromptFn("tecnico-paper-system");
      const userMsg =
        (opts.tema ? `Tema / para qué se necesita: ${opts.tema}\n\n` : "") +
        `Fuente: ${opts.source}\n\nContenido de la fuente (puede venir recortado):\n\n${raw.slice(0, TECH_RAW_CAP)}`;
      const res = await chatFn(
        cfg,
        "docs",
        [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        { temperature: 0.2, maxTokens: 4000 },
        "tecnico-paper",
      );
      paperBody = res.content.trim();
    } catch (e) {
      log.warn("attachments", "no se pudo destilar el documento técnico; guardo la fuente cruda", { err: e });
    }
  }

  if (!paperBody) {
    paperBody =
      `# ${opts.title}\n\n> ⚠️ No se pudo destilar automáticamente; se incluye la fuente tal cual.\n\n` +
      raw.slice(0, TECH_RAW_CAP);
  }

  return composeTechnicalPaper({ title: opts.title, paperBody, source: opts.source, fechaISO });
}

/**
 * Registra un DOCUMENTO TÉCNICO a partir de una fuente ya obtenida (URL descargada o texto pegado):
 *  - destila la fuente → `tecnicos/DT-NNN-*.md` (indexado, citable por RAG/MCP/builder),
 *  - guarda la cruda → `tecnicos/DT-NNN-*.fuente.md` (artefacto NO indexado, recuperable).
 */
export async function saveTechnicalDoc(
  opts: { projectId: string; name: string; source: string; rawMarkdown: string; tema?: string },
  deps: TechnicalDocDeps = {},
): Promise<TechnicalDocResult> {
  const { rootPath } = await projectRow(opts.projectId);
  const cfg = await loadConfig();

  const numbering = await nextDocNumberInDir(rootPath, TECH_PREFIX, TECH_DIR);
  const name = opts.name.trim() || opts.tema?.trim() || "documento-tecnico";
  const { docPath, sourcePath, title } = technicalDocPaths(numbering.nextPadded, name);

  const paper = await buildTechnicalPaper(
    cfg,
    { source: opts.source, rawMarkdown: opts.rawMarkdown, tema: opts.tema, title },
    deps,
  );

  // Paper técnico: disco + BD + índice semántico (el camino único de escritura de papers).
  await saveProjectDocument(cfg, opts.projectId, {
    ruta: docPath,
    contenido: paper,
    titulo: title,
    tags: ["tecnico", "aportado", "referencia"],
  });

  // Fuente cruda: SOLO a disco (sin fila documents ni Qdrant) → no contamina el corpus, pero queda recuperable.
  const fechaISO = (deps.now?.() ?? new Date()).toISOString();
  const rawHeader = [
    "---",
    "tipo: fuente cruda de un documento técnico (no indexada)",
    `origen: ${opts.source}`,
    `fecha: ${fechaISO}`,
    `paper: ${docPath}`,
    "---",
    "",
  ].join("\n");
  const absSource = path.join(rootPath, sourcePath);
  await fs.mkdir(path.dirname(absSource), { recursive: true });
  await fs.writeFile(absSource, rawHeader + opts.rawMarkdown.trim() + "\n", "utf-8");

  log.info("attachments", "documento técnico registrado", { docPath, sourcePath, origen: opts.source });
  return { path: docPath, sourcePath, title, number: numbering.nextPadded };
}
