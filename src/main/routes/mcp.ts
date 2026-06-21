import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  getDocument,
  getKnowledgeBaseFile,
  listDocuments,
  listKnowledgeBase,
  listProjects,
  searchDocuments,
  searchKnowledgeBase,
} from "../tools/knowledge.js";
import { saveProjectDocument } from "../papers/save.js";
import { nextDocNumberForProject } from "../papers/numbering.js";
import { registerGovernanceMcpTools } from "../tools/governance-tools.js";
import { loadConfig } from "../config.js";

const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const asError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "AutoCode", version: "0.1.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista los proyectos activos en AutoCode con su ID, nombre y descripción." },
    async () => asText(await listProjects()),
  );

  server.registerTool(
    "list_documents",
    {
      description: "Lista los documentos (papers de negocio) de un proyecto dado su ID.",
      inputSchema: { project_id: z.string().describe("ID del proyecto") },
    },
    async ({ project_id }) => asText(await listDocuments(project_id)),
  );

  server.registerTool(
    "get_document",
    {
      description: "Obtiene el contenido completo (último revision) de un documento dado su ID.",
      inputSchema: { document_id: z.string().describe("ID del documento") },
    },
    async ({ document_id }) => {
      const doc = await getDocument(document_id);
      return doc ? asText(doc) : asError(`Documento ${document_id} no encontrado`);
    },
  );

  server.registerTool(
    "search_documents",
    {
      description:
        "Búsqueda semántica por similitud en documentos de negocio usando embeddings. " +
        "Devuelve los fragmentos más relevantes con su puntuación, título, ruta y texto.",
      inputSchema: {
        query: z.string().describe("Pregunta o concepto a buscar"),
        project_id: z
          .string()
          .optional()
          .describe("ID del proyecto (opcional; si se omite busca en todos los proyectos)"),
        top_k: z.number().int().min(1).max(20).optional().default(5).describe("Máx resultados (1-20)"),
      },
    },
    async ({ query, project_id, top_k }) => {
      const r = await searchDocuments({ query, projectId: project_id, topK: top_k });
      if (!r.ok) return asError(`Error: ${r.error}`);
      if (r.hits.length === 0) return asText("No hay proyectos con documentos indexados.");
      return asText(r.hits);
    },
  );

  server.registerTool(
    "create_document",
    {
      description:
        "Crea o actualiza un documento de un proyecto y lo guarda en disco + base de datos + índice " +
        "semántico. Para decisiones (decisiones/ADR-NNN-nombre.md), reglas de negocio " +
        "(reglas/RN-NNN-nombre.md) o pantallas (pantallas/nombre.md). Misma ruta = upsert.",
      inputSchema: {
        project_id: z.string().describe("ID del proyecto"),
        ruta: z.string().describe("Ruta relativa .md, p.ej. reglas/RN-001-validaciones.md"),
        contenido: z.string().describe("Contenido completo en Markdown"),
        titulo: z.string().optional().describe("Título (opcional; si falta se deduce del # H1)"),
        tags: z.array(z.string()).optional().describe("Etiquetas (opcional)"),
      },
    },
    async ({ project_id, ruta, contenido, titulo, tags }) => {
      try {
        const cfg = await loadConfig();
        const r = await saveProjectDocument(cfg, project_id, { ruta, contenido, titulo, tags });
        return asText({ ok: true, ruta: r.ruta, creado: r.created });
      } catch (e: any) {
        return asError(`Error guardando el documento: ${e?.message ?? e}`);
      }
    },
  );

  server.registerTool(
    "next_doc_number",
    {
      description:
        "Devuelve el siguiente número libre para un documento con prefijo numerado (ADR, RN, etc.) " +
        "escaneando los ficheros que YA existen en su carpeta. Llámalo ANTES de crear un documento " +
        "nuevo con create_document para no repetir números. Devuelve el número sugerido, el esqueleto " +
        "de ruta (al que solo añades el nombre/slug y '.md') y la lista de los que ya existen: si vas " +
        "a actualizar uno existente, reutiliza su ruta exacta en vez de crear otro.",
      inputSchema: {
        project_id: z.string().describe("ID del proyecto"),
        prefix: z.string().describe('Prefijo del documento, p.ej. "ADR" o "RN"'),
        folder: z
          .string()
          .optional()
          .describe('Carpeta relativa, p.ej. "reglas". Opcional para ADR (decisiones) y RN (reglas).'),
      },
    },
    async ({ project_id, prefix, folder }) => {
      try {
        return asText(await nextDocNumberForProject(project_id, prefix, folder));
      } catch (e: any) {
        return asError(`Error calculando el siguiente número: ${e?.message ?? e}`);
      }
    },
  );

  server.registerTool(
    "list_knowledge_base",
    {
      description:
        "Lista los ficheros Markdown disponibles en la biblioteca de patrones (library) o en las plantillas (templates).",
      inputSchema: {
        source: z.enum(["library", "templates"]).describe('"library" o "templates"'),
      },
    },
    async ({ source }) => {
      const files = await listKnowledgeBase(source);
      return files.length ? asText(files) : asText(`No se encontraron ficheros en ${source}.`);
    },
  );

  server.registerTool(
    "get_knowledge_base_file",
    {
      description:
        "Lee el contenido completo de un fichero Markdown de la biblioteca (library) o las plantillas (templates).",
      inputSchema: {
        source: z.enum(["library", "templates"]).describe('"library" o "templates"'),
        file_path: z.string().describe('Ruta relativa dentro del origen, p.ej. "ddd/agregados.md"'),
      },
    },
    async ({ source, file_path }) => {
      const r = await getKnowledgeBaseFile(source, file_path);
      return r.ok ? asText(r.content ?? "") : asError(r.error ?? "error");
    },
  );

  server.registerTool(
    "search_knowledge_base",
    {
      description:
        "Búsqueda semántica en la biblioteca de patrones y/o plantillas de AutoCode.",
      inputSchema: {
        query: z.string().describe("Pregunta o concepto a buscar"),
        source: z.enum(["library", "templates", "all"]).optional().default("all"),
        top_k: z.number().int().min(1).max(20).optional().default(5).describe("Máx resultados (1-20)"),
      },
    },
    async ({ query, source, top_k }) => {
      const r = await searchKnowledgeBase({ query, source, topK: top_k });
      if (!r.ok) return asError(`Error: ${r.error}`);
      if (r.hits.length === 0)
        return asText("Sin resultados (¿colección no indexada todavía? el índice arranca en segundo plano).");
      return asText(r.hits);
    },
  );

  // Gobernanza de ficheros por categoría: <cat>_listar/_leer/_guardar/_borrar (decisiones, reglas,
  // pantallas, patrones) + media_listar/_borrar + planes_listar/_leer (solo lectura).
  registerGovernanceMcpTools(server);

  return server;
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (req, reply) => {
    reply.hijack();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildMcpServer();
    reply.raw.on("close", () => {
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e: any) {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ error: e.message }));
      }
    }
  });

  app.get("/mcp", (_req, reply) => {
    reply.code(405).send({ error: "MCP requires POST requests (stateless mode)" });
  });

  app.delete("/mcp", (_req, reply) => {
    reply.code(405).send({ error: "Stateless MCP — no sessions to delete" });
  });
}
