import type { AppConfig } from "@shared";
import type { ChatTool } from "../llm/client.js";
import {
  getDocument,
  listDocuments,
  listProjects,
  searchDocuments,
  searchKnowledgeBase,
} from "../tools/knowledge.js";
import { saveProjectDocument } from "../papers/save.js";
import { nextDocNumberForProject } from "../papers/numbering.js";
import { fetchUrlAsMarkdown, saveTechnicalDoc } from "../attachments.js";

const json = (v: unknown) => JSON.stringify(v);

/**
 * Tools que el chat ofrece al modelo (mismas capacidades que el MCP, misma implementación).
 * `currentProjectId` se usa como valor por defecto para que el modelo no tenga que repetirlo.
 *
 * `readOnly`: deja SOLO las tools de lectura/búsqueda (biblioteca + papers). El chat las usa para
 * responder con criterio (p.ej. "¿qué autenticación puedes usar?" → busca en la biblioteca). El que
 * ESCRIBE los papers es el `documenter` (un único escritor evita ADRs/reglas a medias durante el turno).
 */
export function buildChatTools(
  cfg: AppConfig,
  currentProjectId: string,
  opts: { readOnly?: boolean } = {},
): ChatTool[] {
  const writeTools: ChatTool[] = [
    {
      name: "guardar_documento",
      description:
        "Guarda (o actualiza) un documento del proyecto en disco e índice: decisiones de arquitectura " +
        "(decisiones/ADR-NNN-nombre.md), reglas de negocio (reglas/RN-NNN-nombre.md), pantallas " +
        "(pantallas/nombre.md). ÚSALO cuando el usuario defina una especificación, decisión, regla o " +
        "pantalla que deba quedar registrada — no te limites a describirla en el chat, persístela. " +
        "Misma ruta = actualiza (upsert). Escribe el contenido completo en Markdown.",
      parameters: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta relativa .md, p.ej. reglas/RN-001-validaciones.md" },
          titulo: { type: "string", description: "Título del documento (opcional; si falta se deduce del # H1)" },
          contenido: { type: "string", description: "Markdown completo del documento" },
          tags: { type: "array", items: { type: "string" }, description: "Etiquetas (opcional)" },
        },
        required: ["ruta", "contenido"],
      },
      run: async (a) => {
        try {
          const r = await saveProjectDocument(cfg, currentProjectId, {
            ruta: a.ruta, contenido: a.contenido, titulo: a.titulo, tags: a.tags,
          });
          return json({ ok: true, ruta: r.ruta, creado: r.created });
        } catch (e: any) {
          return `Error guardando el documento: ${e?.message ?? e}`;
        }
      },
    },
    {
      name: "siguiente_numero_documento",
      description:
        "Calcula el siguiente número libre para un documento numerado (ADR, RN, ...) mirando los que " +
        "YA existen en su carpeta. Llámalo ANTES de guardar_documento al CREAR uno nuevo, para no " +
        "repetir números. Devuelve el número sugerido, el esqueleto de ruta y la lista de existentes " +
        "(si vas a actualizar uno, reutiliza su ruta exacta en vez de crear otro).",
      parameters: {
        type: "object",
        properties: {
          prefix: { type: "string", description: 'Prefijo, p.ej. "ADR" o "RN"' },
          folder: {
            type: "string",
            description: 'Carpeta, p.ej. "reglas". Opcional para ADR (decisiones) y RN (reglas).',
          },
          project_id: { type: "string", description: "Opcional; por defecto el proyecto actual" },
        },
        required: ["prefix"],
      },
      run: async (a) => {
        try {
          return json(await nextDocNumberForProject(a.project_id ?? currentProjectId, a.prefix, a.folder));
        } catch (e: any) {
          return `Error calculando el siguiente número: ${e?.message ?? e}`;
        }
      },
    },
  ];

  const readTools: ChatTool[] = [
    {
      name: "search_documents",
      description:
        "Busca por similitud semántica en los papers/documentos del proyecto. Úsalo para responder " +
        "preguntas sobre lo que se ha decidido o documentado. Por defecto busca en el proyecto actual.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Qué buscar" },
          project_id: { type: "string", description: "Opcional; por defecto el proyecto actual" },
          top_k: { type: "integer", minimum: 1, maximum: 20, description: "Máx resultados (def. 5)" },
        },
        required: ["query"],
      },
      run: async (a) => {
        const r = await searchDocuments(
          { query: a.query, projectId: a.project_id ?? currentProjectId, topK: a.top_k ?? 5 },
          cfg,
        );
        return r.ok ? json(r.hits) : `Error: ${r.error}`;
      },
    },
    {
      name: "list_projects",
      description: "Lista los proyectos de AutoCode con su id, nombre y descripción.",
      parameters: { type: "object", properties: {} },
      run: async () => json(await listProjects()),
    },
    {
      name: "list_documents",
      description: "Lista los documentos de un proyecto. Por defecto el proyecto actual.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Opcional; por defecto el proyecto actual" },
        },
      },
      run: async (a) => json(await listDocuments(a.project_id ?? currentProjectId)),
    },
    {
      name: "get_document",
      description: "Devuelve el contenido completo de un documento dado su id.",
      parameters: {
        type: "object",
        properties: { document_id: { type: "string" } },
        required: ["document_id"],
      },
      run: async (a) => {
        const doc = await getDocument(a.document_id);
        return doc ? json(doc) : `Documento ${a.document_id} no encontrado`;
      },
    },
    {
      name: "search_knowledge_base",
      description:
        "Busca en la biblioteca de patrones y plantillas transversales de AutoCode (no específicas del proyecto).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          source: { type: "string", enum: ["library", "templates", "all"] },
          top_k: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
      run: async (a) => {
        const r = await searchKnowledgeBase({ query: a.query, source: a.source ?? "all", topK: a.top_k ?? 5 }, cfg);
        return r.ok ? json(r.hits) : `Error: ${r.error}`;
      },
    },
  ];

  // Ingesta de FUENTES EXTERNAS (no es autoría de papers de negocio, así que está disponible también en
  // modo readOnly): registra una especificación técnica que la app debe respetar al pie de la letra.
  const ingestTools: ChatTool[] = [
    {
      name: "registrar_documento_tecnico",
      description:
        "Registra una FUENTE TÉCNICA (especificación de formato, norma/reglamento, esquema oficial, doc de " +
        "una API de un tercero) como 'documento técnico' del proyecto. Úsalo cuando el usuario te pase una " +
        "URL de descarga o pegue el contenido de una especificación que la app debe respetar EXACTAMENTE. " +
        "Descarga/canoniza la fuente, la destila en un paper técnico citable e indexado (consultable luego al " +
        "construir la app) y conserva la fuente original. Pasa `url` O `texto` (uno de los dos).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL pública de descarga (http/https) de la especificación. Úsala si el usuario dio un enlace." },
          texto: { type: "string", description: "Contenido de la especificación si el usuario lo pegó directamente (alternativa a url)." },
          tema: { type: "string", description: "De qué trata / para qué se necesita, p.ej. 'formato XML de bases de cotización a la Seguridad Social'." },
          nombre: { type: "string", description: "Nombre corto para titular el documento (opcional; se deduce del tema/título si falta)." },
        },
      },
      run: async (a) => {
        try {
          const url = typeof a.url === "string" ? a.url.trim() : "";
          const texto = typeof a.texto === "string" ? a.texto.trim() : "";
          if (!url && !texto) return "Indica una `url` de descarga o pega el `texto` de la especificación.";
          const source = url || "texto aportado en el chat";
          let raw = texto;
          let nombre = (a.nombre || a.tema || "").trim();
          if (url) {
            const fetched = await fetchUrlAsMarkdown(url);
            raw = fetched.markdown;
            if (!nombre) nombre = fetched.title;
          }
          const r = await saveTechnicalDoc({
            projectId: currentProjectId, name: nombre || "documento técnico", source, rawMarkdown: raw, tema: a.tema,
          });
          return json({ ok: true, ruta: r.path, titulo: r.title, fuente: source });
        } catch (e: any) {
          return `No se pudo registrar el documento técnico: ${e?.message ?? e}`;
        }
      },
    },
  ];

  return opts.readOnly ? [...ingestTools, ...readTools] : [...writeTools, ...ingestTools, ...readTools];
}
