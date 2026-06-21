import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { AppType } from "@shared";
import { db, schema } from "./db/client.js";
import { loadConfig } from "./config.js";
import { ingestRevision } from "./papers/ingest.js";
import { log } from "./log.js";
import { deriveAppType } from "./architecture-derive.js";

export { deriveAppType };

/**
 * ADR de arquitectura: el paper fundacional que define el stack/topología de la app.
 * Es la ÚNICA fuente de verdad para decidir si la app es de escritorio o web (y más),
 * en vez de un selector por generación. Vive como un documento normal del proyecto, así
 * que el chat lo elicita, el documenter lo escribe y el planner/coder lo leen del corpus.
 */
export const ARCH_DOC_PATH = "decisiones/ADR-000-arquitectura.md";
export const ARCH_DOC_TITLE = "ADR-000: Arquitectura";

/** Plantilla inicial en lenguaje de usuario (la usa la pestaña si aún no hay ADR). */
export const ARCH_TEMPLATE = `# ADR-000: Arquitectura

## Cómo se usará la aplicación
- **Quién la usa:** una sola persona (yo)
- **Desde dónde:** en mi ordenador
- **Datos compartidos entre varias personas:** no
- **Necesita usuario y contraseña:** no
- **Tiene que estar disponible en internet:** no

## Decisiones técnicas
- **Tipo:** escritorio
- **Dónde se guardan los datos:** en el propio equipo
- **Multiusuario:** no
- **Cómo se entrega:** instalador para Windows/Mac

## Por qué
Aplicación monopuesto para uso personal; sin servidor ni conexión necesaria.
`;

export interface Architecture {
  documentId: string;
  body: string;
  appType: AppType;
  /** true si sigue siendo la plantilla por defecto (el usuario aún no la ha confirmado). */
  isDefault: boolean;
}

async function getProjectRoot(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ rootPath: schema.projects.rootPath, collection: schema.projects.qdrantCollection })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.rootPath ?? null;
}

/** Lee el ADR de arquitectura del proyecto (última revisión), o null si aún no existe. */
export async function getArchitecture(projectId: string): Promise<Architecture | null> {
  const doc = (
    await db()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, ARCH_DOC_PATH), isNull(schema.documents.deletedAt)))
      .limit(1)
  )[0];
  if (!doc) return null;

  const rev = (
    await db()
      .select({ body: schema.documentRevisions.body })
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, doc.id))
      .orderBy(desc(schema.documentRevisions.createdAt))
      .limit(1)
  )[0];
  const body = rev?.body ?? "";
  return { documentId: doc.id, body, appType: deriveAppType(body), isDefault: isDefaultBody(body) };
}

function isDefaultBody(body: string): boolean {
  return body.trim() === ARCH_TEMPLATE.trim();
}

/**
 * Devuelve el ADR de arquitectura; si no existe, CREA el de por defecto (monopuesto) y lo
 * devuelve. Idempotente. Lo usa "Generar app" para que el usuario siempre tenga uno (visible
 * en Documentos) sin tener que saber lo que es la "arquitectura".
 */
export async function ensureArchitecture(projectId: string): Promise<Architecture> {
  const existing = await getArchitecture(projectId);
  if (existing) return existing;
  return saveArchitecture(projectId, ARCH_TEMPLATE);
}

/**
 * Guarda/actualiza el ADR de arquitectura: fichero en disco + documento/revisión en BD +
 * ingesta a Qdrant (best-effort). Mismo destino que escribe el documenter, para que el
 * resto del pipeline lo vea igual que cualquier paper.
 */
export async function saveArchitecture(projectId: string, body: string): Promise<Architecture> {
  const rootPath = await getProjectRoot(projectId);
  if (!rootPath) throw new Error("proyecto no encontrado");

  const abs = path.join(rootPath, ARCH_DOC_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf-8");

  const existing = (
    await db()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.path, ARCH_DOC_PATH)))
      .limit(1)
  )[0];

  let docId: string;
  if (existing) {
    docId = existing.id;
    await db().update(schema.documents)
      .set({ title: ARCH_DOC_TITLE, deletedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, docId));
  } else {
    docId = `doc_${ulid().toLowerCase()}`;
    await db().insert(schema.documents).values({
      id: docId, projectId, path: ARCH_DOC_PATH, title: ARCH_DOC_TITLE, tags: ["arquitectura"], status: "active",
    });
  }

  const revId = `rev_${ulid().toLowerCase()}`;
  await db().insert(schema.documentRevisions).values({
    id: revId, documentId: docId, projectId, body, authorRole: "user",
  });

  try {
    const cfg = await loadConfig();
    const project = (
      await db().select({ c: schema.projects.qdrantCollection }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1)
    )[0];
    if (project) await ingestRevision(cfg, projectId, project.c, docId, revId, ARCH_DOC_PATH, ARCH_DOC_TITLE, body);
  } catch (e) {
    log.warn("architecture", "no se pudo indexar el ADR de arquitectura en Qdrant", { err: e });
  }

  return { documentId: docId, body, appType: deriveAppType(body), isDefault: isDefaultBody(body) };
}
