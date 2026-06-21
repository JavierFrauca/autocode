import type { AppConfig } from "@shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChatTool } from "../llm/client.js";
import { loadConfig } from "../config.js";
import { getKnowledgeBaseFile, listKnowledgeBase, searchDocuments, searchKnowledgeBase } from "./knowledge.js";
import * as gov from "./governance.js";

const json = (v: unknown) => JSON.stringify(v);

/**
 * Tools de GOBERNANZA de ficheros por categoría, generadas en bloque para el CHAT y para el MCP (misma
 * implementación, en `governance.ts`). Por categoría de documento: `<cat>_listar/_leer/_guardar/_borrar`.
 * Media: `media_listar/_borrar` (subir queda en la UI). Planes: `planes_listar/_leer` (solo lectura).
 */

// ───────────────────────── CHAT (proyecto fijo, cfg ligada) ─────────────────────────

export function buildGovernanceChatTools(cfg: AppConfig, projectId: string): ChatTool[] {
  const tools: ChatTool[] = [];

  for (const cat of gov.DOC_CATEGORIES) {
    tools.push(
      {
        name: `${cat}_listar`,
        description: `Lista los ficheros de ${cat}/ del proyecto (devuelve sus rutas).`,
        parameters: { type: "object", properties: {} },
        run: async () => json(await gov.listCategoryDocs(projectId, cat)),
      },
      {
        name: `${cat}_leer`,
        description: `Lee el contenido completo de un fichero de ${cat}/ por su ruta.`,
        parameters: {
          type: "object",
          properties: { ruta: { type: "string", description: `Ruta, p.ej. ${cat}/nombre.md` } },
          required: ["ruta"],
        },
        run: async (a) => (await gov.readCategoryDoc(projectId, cat, a.ruta)) ?? `No encontrado: ${a.ruta}`,
      },
      {
        name: `${cat}_guardar`,
        description: `Crea o actualiza (upsert por ruta) un fichero de ${cat}/ con su Markdown completo.`,
        parameters: {
          type: "object",
          properties: {
            ruta: { type: "string", description: `Ruta dentro de ${cat}/, p.ej. ${cat}/nombre.md` },
            contenido: { type: "string", description: "Markdown completo del documento" },
            titulo: { type: "string", description: "Título (opcional; si falta se deduce del # H1)" },
            tags: { type: "array", items: { type: "string" }, description: "Etiquetas (opcional)" },
          },
          required: ["ruta", "contenido"],
        },
        run: async (a) => {
          try {
            const r = await gov.saveCategoryDoc(cfg, projectId, cat, a.ruta, a.contenido, a.titulo, a.tags);
            return json({ ok: true, ruta: r.ruta, creado: r.created });
          } catch (e: any) {
            return `Error guardando ${a.ruta}: ${e?.message ?? e}`;
          }
        },
      },
      {
        name: `${cat}_borrar`,
        description: `Borra un fichero de ${cat}/ por su ruta (disco + índice). Irreversible.`,
        parameters: {
          type: "object",
          properties: { ruta: { type: "string", description: `Ruta dentro de ${cat}/` } },
          required: ["ruta"],
        },
        run: async (a) => {
          try {
            await gov.deleteCategoryDoc(cfg, projectId, cat, a.ruta);
            return json({ ok: true, borrado: a.ruta });
          } catch (e: any) {
            return `Error borrando ${a.ruta}: ${e?.message ?? e}`;
          }
        },
      },
    );
  }

  tools.push(
    {
      name: "media_listar",
      description: "Lista las imágenes de media/ (nombre, tamaño en bytes y ruta).",
      parameters: { type: "object", properties: {} },
      run: async () => json(await gov.listMedia(projectId)),
    },
    {
      name: "media_borrar",
      description: "Borra una imagen de media/ por su nombre de fichero. (Subir imágenes se hace en la UI.)",
      parameters: {
        type: "object",
        properties: { nombre: { type: "string", description: "Nombre del fichero, p.ej. logo.png" } },
        required: ["nombre"],
      },
      run: async (a) => json({ ok: await gov.deleteMedia(projectId, a.nombre), borrado: a.nombre }),
    },
    {
      name: "planes_listar",
      description: "Lista los ficheros de planes/ (el plan vivo y los informes de ejecución). Solo lectura.",
      parameters: { type: "object", properties: {} },
      run: async () => json(await gov.listPlanes(projectId)),
    },
    {
      name: "planes_leer",
      description: "Lee un fichero de planes/ por su nombre. Solo lectura (el plan se genera/actualiza en su pantalla).",
      parameters: {
        type: "object",
        properties: { nombre: { type: "string", description: "Nombre del fichero en planes/" } },
        required: ["nombre"],
      },
      run: async (a) => (await gov.readPlanFile(projectId, a.nombre)) ?? `No encontrado: ${a.nombre}`,
    },
  );

  return tools;
}

// ───────────────────────── PLANNER (solo LECTURA: doc del proyecto + biblioteca) ─────────────────────────

/**
 * Tools de SOLO LECTURA para el planner agéntico: consultar la documentación del proyecto por categoría
 * (decisiones/reglas/pantallas/patrones + media) y la BIBLIOTECA de AutoCode (patrones + plantillas), en
 * vez de meterle todo el corpus en el prompt. Así escala a proyectos grandes y el modelo lee lo que necesita.
 */
export function buildPlannerTools(cfg: AppConfig, projectId: string): ChatTool[] {
  const tools: ChatTool[] = [];

  for (const cat of gov.DOC_CATEGORIES) {
    tools.push(
      {
        name: `${cat}_listar`,
        description: `Lista los ficheros de ${cat}/ del proyecto (sus rutas).`,
        parameters: { type: "object", properties: {} },
        run: async () => json(await gov.listCategoryDocs(projectId, cat)),
      },
      {
        name: `${cat}_leer`,
        description: `Lee el contenido completo de un fichero de ${cat}/ por su ruta.`,
        parameters: { type: "object", properties: { ruta: { type: "string" } }, required: ["ruta"] },
        run: async (a) => (await gov.readCategoryDoc(projectId, cat, a.ruta)) ?? `No encontrado: ${a.ruta}`,
      },
    );
  }

  tools.push(
    {
      name: "media_listar",
      description: "Lista las imágenes de media/ del proyecto (logos, capturas…).",
      parameters: { type: "object", properties: {} },
      run: async () => json(await gov.listMedia(projectId)),
    },
    {
      name: "buscar_documentacion",
      description: "Búsqueda semántica en los papers del proyecto (decisiones/reglas/pantallas). Para encontrar lo relevante a un tema sin leerlo todo.",
      parameters: { type: "object", properties: { query: { type: "string" }, top_k: { type: "integer" } }, required: ["query"] },
      run: async (a) => {
        const r = await searchDocuments({ query: a.query, projectId, topK: a.top_k ?? 6 }, cfg);
        return r.ok ? json(r.hits) : `Error: ${r.error}`;
      },
    },
    {
      name: "biblioteca_buscar",
      description: "Búsqueda semántica en la BIBLIOTECA de AutoCode: patrones (library) y plantillas (templates) transversales — auth, dashboards, hexagonal, formatos CSV/Excel/PDF, UI… Úsala para saber con qué recursos REALES cuentas y referenciarlos en `recibe`.",
      parameters: { type: "object", properties: { query: { type: "string" }, source: { type: "string", enum: ["library", "templates", "all"] }, top_k: { type: "integer" } }, required: ["query"] },
      run: async (a) => {
        const r = await searchKnowledgeBase({ query: a.query, source: a.source ?? "all", topK: a.top_k ?? 5 }, cfg);
        return r.ok ? json(r.hits) : `Error: ${r.error}`;
      },
    },
    {
      name: "biblioteca_listar",
      description: 'Lista los ficheros de la biblioteca. source: "library" (patrones) o "templates" (plantillas de código/andamiaje).',
      parameters: { type: "object", properties: { source: { type: "string", enum: ["library", "templates"] } }, required: ["source"] },
      run: async (a) => json(await listKnowledgeBase(a.source)),
    },
    {
      name: "biblioteca_leer",
      description: "Lee un fichero de la biblioteca/plantillas por su ruta relativa (p.ej. ddd/agregados.md).",
      parameters: { type: "object", properties: { source: { type: "string", enum: ["library", "templates"] }, ruta: { type: "string" } }, required: ["source", "ruta"] },
      run: async (a) => {
        const r = await getKnowledgeBaseFile(a.source, a.ruta);
        return r.ok ? (r.content ?? "") : `Error: ${r.error}`;
      },
    },
  );

  return tools;
}

// ───────────────────────── MCP (multi-proyecto: project_id explícito) ─────────────────────────

const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const asError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function registerGovernanceMcpTools(server: McpServer): void {
  for (const cat of gov.DOC_CATEGORIES) {
    server.registerTool(
      `${cat}_listar`,
      { description: `Lista los ficheros de ${cat}/ de un proyecto.`, inputSchema: { project_id: z.string() } },
      async ({ project_id }) => asText(await gov.listCategoryDocs(project_id, cat)),
    );
    server.registerTool(
      `${cat}_leer`,
      { description: `Lee un fichero de ${cat}/ por su ruta.`, inputSchema: { project_id: z.string(), ruta: z.string() } },
      async ({ project_id, ruta }) => {
        const c = await gov.readCategoryDoc(project_id, cat, ruta);
        return c == null ? asError(`No encontrado: ${ruta}`) : asText(c);
      },
    );
    server.registerTool(
      `${cat}_guardar`,
      {
        description: `Crea o actualiza (upsert por ruta) un fichero de ${cat}/.`,
        inputSchema: {
          project_id: z.string(),
          ruta: z.string().describe(`Ruta dentro de ${cat}/`),
          contenido: z.string(),
          titulo: z.string().optional(),
          tags: z.array(z.string()).optional(),
        },
      },
      async ({ project_id, ruta, contenido, titulo, tags }) => {
        try {
          const cfg = await loadConfig();
          const r = await gov.saveCategoryDoc(cfg, project_id, cat, ruta, contenido, titulo, tags);
          return asText({ ok: true, ruta: r.ruta, creado: r.created });
        } catch (e: any) {
          return asError(`Error: ${e?.message ?? e}`);
        }
      },
    );
    server.registerTool(
      `${cat}_borrar`,
      { description: `Borra un fichero de ${cat}/ por su ruta.`, inputSchema: { project_id: z.string(), ruta: z.string() } },
      async ({ project_id, ruta }) => {
        try {
          const cfg = await loadConfig();
          await gov.deleteCategoryDoc(cfg, project_id, cat, ruta);
          return asText({ ok: true, borrado: ruta });
        } catch (e: any) {
          return asError(`Error: ${e?.message ?? e}`);
        }
      },
    );
  }

  server.registerTool(
    "media_listar",
    { description: "Lista las imágenes de media/ de un proyecto.", inputSchema: { project_id: z.string() } },
    async ({ project_id }) => asText(await gov.listMedia(project_id)),
  );
  server.registerTool(
    "media_borrar",
    { description: "Borra una imagen de media/ por su nombre.", inputSchema: { project_id: z.string(), nombre: z.string() } },
    async ({ project_id, nombre }) => asText({ ok: await gov.deleteMedia(project_id, nombre), borrado: nombre }),
  );
  server.registerTool(
    "planes_listar",
    { description: "Lista los ficheros de planes/ (solo lectura).", inputSchema: { project_id: z.string() } },
    async ({ project_id }) => asText(await gov.listPlanes(project_id)),
  );
  server.registerTool(
    "planes_leer",
    { description: "Lee un fichero de planes/ por su nombre (solo lectura).", inputSchema: { project_id: z.string(), nombre: z.string() } },
    async ({ project_id, nombre }) => {
      const c = await gov.readPlanFile(project_id, nombre);
      return c == null ? asError(`No encontrado: ${nombre}`) : asText(c);
    },
  );
}
