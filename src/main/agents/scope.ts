import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppType } from "@shared";
import { db, schema } from "../db/client.js";
import { getArchitecture } from "../architecture.js";
import { flattenMap } from "../screens/map.js";
import { readMap } from "../screens/service.js";

/**
 * Motor de COMPLETITUD del alcance. La entrevista del chat es reactiva; este módulo le da un cerebro:
 * a partir de los papers ya escritos calcula QUÉ PIEZAS del alcance están cubiertas y cuál es el hueco
 * más importante, para que el chat persiga el cierre (1-2 preguntas por turno, en cristiano) en vez de
 * esperar a que el usuario se acuerde de todo. El núcleo `computeScope` es PURO (sin IO) y testeable;
 * `getProjectScope` recoge el inventario del proyecto y lo alimenta. El resultado se inyecta como
 * contexto del chat (`formatScopeForChat`) y se expone a la UI (indicador de progreso).
 *
 * La ESTRUCTURA de pantallas se lee del MAPA (`pantallas/_mapa.md`, fuente única), no de un artefacto
 * propio; el MODELO DE DATOS, de `dominios/` (entidades del negocio).
 */

/** Inventario determinista del proyecto: lo que de verdad hay escrito, ya normalizado. */
export interface ScopeInventory {
  appType: AppType | null;
  /** El ADR-000 existe y el usuario ya lo confirmó (no es la plantilla por defecto). */
  architectureConfirmed: boolean;
  /** El ADR-000 tiene sección de Autenticación (solo aplica a web). */
  hasAuthSection: boolean;
  /** Existe un ADR de roles/permisos (solo aplica a web). */
  hasRolesDoc: boolean;
  /** Slugs de las entidades del modelo de datos (`dominios/<slug>.md`). */
  entidades: string[];
  /** Nº de pantallas en el mapa de estructura (`pantallas/_mapa.md`). */
  screenCount: number;
  /** Nº de reglas de negocio escritas. */
  reglasCount: number;
}

export type ScopeStatus = "ok" | "partial" | "missing";

export interface ScopeItem {
  key: string;
  label: string;
  status: ScopeStatus;
  detail: string;
  /** Pregunta no técnica sugerida para cerrar el hueco (solo si no está `ok`). */
  question?: string;
}

export interface ScopeReport {
  appType: AppType | null;
  items: ScopeItem[];
  required: number;
  done: number;
  coverage: number;
  closed: boolean;
  nextQuestion: string | null;
}

const ICON: Record<ScopeStatus, string> = { ok: "✅", partial: "⚠️", missing: "❌" };

/** ¿El tipo de app tiene interfaz de usuario (pantallas)? */
function hasUi(t: AppType | null): boolean {
  return t === "electron" || t === "server";
}

/**
 * Núcleo PURO: dado el inventario, produce el informe de cobertura. Sin IO → totalmente testeable.
 * El orden de los items define la PRIORIDAD del hueco a cerrar (de arriba a abajo).
 */
export function computeScope(inv: ScopeInventory): ScopeReport {
  const t = inv.appType;
  const ui = hasUi(t);
  const web = t === "server";
  const items: ScopeItem[] = [];

  // 1) Arquitectura — siempre. Sin esto no sabemos ni el tipo de app.
  items.push(
    !t || !inv.architectureConfirmed
      ? {
          key: "arquitectura",
          label: "Cómo se usará",
          status: t ? "partial" : "missing",
          detail: t ? "sin confirmar (plantilla por defecto)" : "sin definir",
          question:
            "Para empezar, ¿cómo vas a usar la aplicación: la usas tú solo o también más personas, y desde dónde (tu ordenador, varios sitios, el móvil)?",
        }
      : { key: "arquitectura", label: "Cómo se usará", status: "ok", detail: `tipo: ${t}` },
  );

  // 2) Modelo de datos — siempre (toda app persiste algo).
  items.push(
    inv.entidades.length === 0
      ? {
          key: "modelo-datos",
          label: "Qué datos maneja",
          status: "missing",
          detail: "sin entidades",
          question:
            "¿Qué cosas principales va a guardar y manejar la aplicación? (por ejemplo: clientes, pedidos, productos, facturas)",
        }
      : { key: "modelo-datos", label: "Qué datos maneja", status: "ok", detail: `${inv.entidades.length} entidad(es): ${inv.entidades.join(", ")}` },
  );

  // 3) Autenticación — solo web (login es obligatorio; aquí confirmamos métodos/MFA en el ADR).
  if (web) {
    items.push(
      inv.hasAuthSection
        ? { key: "auth", label: "Acceso a la app", status: "ok", detail: "definido en el ADR de arquitectura" }
        : {
            key: "auth",
            label: "Acceso a la app",
            status: "missing",
            detail: "sin definir",
            question:
              "La aplicación llevará usuario y contraseña. ¿Quieres además poder entrar con cuenta de Google o de Microsoft? ¿Y un código de un solo uso al entrar (más seguridad)?",
          },
    );
    // 4) Roles y permisos — solo web.
    items.push(
      inv.hasRolesDoc
        ? { key: "roles", label: "Quién puede hacer qué", status: "ok", detail: "definidos" }
        : {
            key: "roles",
            label: "Quién puede hacer qué",
            status: "missing",
            detail: "sin definir",
            question:
              "¿Habrá distintos tipos de usuario (por ejemplo administradores y usuarios normales)? ¿Qué puede hacer cada uno; alguien puede borrar cosas y otros no?",
          },
    );
  }

  // 5) Pantallas — solo apps con UI (la estructura sale del mapa `pantallas/_mapa.md`).
  if (ui) {
    items.push(
      inv.screenCount > 0
        ? { key: "pantallas", label: "Pantallas", status: "ok", detail: `${inv.screenCount} pantalla(s) en el mapa` }
        : {
            key: "pantallas",
            label: "Pantallas",
            status: "missing",
            detail: "ninguna",
            question: "¿Qué pantallas necesitas para trabajar con esos datos? (por ejemplo: lista de clientes, ficha de cliente)",
          },
    );
  }

  // 6) Reglas de negocio — siempre recomendable (qué se puede hacer, validaciones, límites).
  items.push(
    inv.reglasCount > 0
      ? { key: "reglas", label: "Reglas y límites", status: "ok", detail: `${inv.reglasCount} regla(s)` }
      : {
          key: "reglas",
          label: "Reglas y límites",
          status: "missing",
          detail: "ninguna",
          question: "¿Hay reglas o límites importantes? (por ejemplo: quién puede hacer qué, validaciones, importes máximos)",
        },
  );

  const required = items.length;
  const done = items.reduce((acc, it) => acc + (it.status === "ok" ? 1 : it.status === "partial" ? 0.5 : 0), 0);
  const coverage = required === 0 ? 1 : done / required;
  const closed = items.every((it) => it.status === "ok");
  const next = items.find((it) => it.status !== "ok");

  return { appType: t, items, required, done, coverage, closed, nextQuestion: next?.question ?? null };
}

/** Slug de un fichero (`dominios/cliente.md` → `cliente`). */
function slugOf(name: string): string {
  return name.replace(/\.md$/i, "").toLowerCase();
}

/** Lista los `.md` de una carpeta del proyecto (vacío si no existe). */
async function listMd(rootPath: string, folder: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(rootPath, folder))).filter((n) => n.toLowerCase().endsWith(".md"));
  } catch {
    return [];
  }
}

async function projectRoot(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ rootPath: schema.projects.rootPath })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.rootPath ?? null;
}

/** Recoge el inventario REAL del proyecto desde sus papers + el mapa de pantallas. */
export async function gatherInventory(projectId: string): Promise<ScopeInventory> {
  const arch = await getArchitecture(projectId).catch(() => null);
  const root = await projectRoot(projectId);

  const entidades = root
    ? (await listMd(root, "dominios")).map(slugOf).filter((s) => !s.startsWith("_"))
    : [];
  const reglas = root ? await listMd(root, "reglas") : [];
  const decisiones = root ? await listMd(root, "decisiones") : [];
  const hasRolesDoc = decisiones.some((n) => /rol|permis/i.test(n));

  let screenCount = 0;
  try {
    screenCount = flattenMap(await readMap(projectId)).length;
  } catch {
    /* sin mapa todavía */
  }

  return {
    appType: arch?.appType ?? null,
    architectureConfirmed: !!arch && !arch.isDefault,
    hasAuthSection: !!arch && /##\s*Autenticaci[oó]n/i.test(arch.body),
    hasRolesDoc,
    entidades,
    screenCount,
    reglasCount: reglas.length,
  };
}

/** Informe de cobertura del proyecto (inventario real → núcleo puro). */
export async function getProjectScope(projectId: string): Promise<ScopeReport> {
  return computeScope(await gatherInventory(projectId));
}

/**
 * Renderiza el informe como bloque de contexto para el chat: el modelo lo usa para perseguir el cierre
 * del alcance sin convertirlo en interrogatorio (1-2 preguntas, ancladas a lo que falta).
 */
export function formatScopeForChat(report: ScopeReport): string {
  const lines = report.items.map((it) => `- ${it.label}: ${ICON[it.status]} ${it.detail}`);
  const pct = Math.round(report.coverage * 100);
  const head =
    `ESTADO DE COBERTURA DEL ALCANCE (${pct}% — úsalo para DIRIGIR la entrevista hacia lo que falta; ` +
    `1-2 preguntas por turno, en cristiano, sin tecnicismos; distingue lo imprescindible de lo que es matiz):`;
  const tail = report.closed
    ? "Todo lo imprescindible está cubierto ✅. Dilo y ofrece pasar a pulir detalles (no sigas interrogando)."
    : `SIGUIENTE HUECO MÁS IMPORTANTE → pregunta por esto ahora: ${report.nextQuestion}`;
  return `${head}\n${lines.join("\n")}\n${tail}`;
}
