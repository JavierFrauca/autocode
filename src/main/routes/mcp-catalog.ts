import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { McpServerConfig } from "@shared";
import { loadConfig, saveConfig } from "../config.js";
import { MCP_CATALOG, getCatalogEntry } from "../mcp/catalog.js";
import { resetMcpConnection } from "../mcp/client.js";

/**
 * API de la biblioteca CERRADA de MCPs (ver `mcp/catalog.ts`). El catálogo en sí no lo edita nadie desde
 * aquí — solo se puede activar/desactivar una entrada existente y rellenar las variables que declare
 * (p.ej. una clave), nunca añadir un comando arbitrario.
 */

const Body = z.object({
  activo: z.boolean(),
  env: z.record(z.string(), z.string()).optional(),
});

export async function registerMcpCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/mcp-catalog", async () => {
    const cfg = await loadConfig();
    const porId = new Map((cfg.mcpServers ?? []).map((s) => [s.id, s]));

    return {
      entradas: MCP_CATALOG.map((entry) => {
        const guardado = porId.get(entry.id);
        return {
          id: entry.id,
          nombre: entry.nombre,
          descripcion: entry.descripcion,
          ventajas: entry.ventajas,
          inconvenientes: entry.inconvenientes,
          estado: entry.estado,
          // Solo las ETIQUETAS de lo que hay que rellenar, nunca el valor guardado (puede ser una clave).
          envRequerido: (entry.envRequerido ?? []).map((f) => ({
            clave: f.clave, etiqueta: f.etiqueta, ayuda: f.ayuda,
            relleno: !!guardado?.env?.[f.clave],
          })),
          activo: !!guardado?.activo,
          activable: entry.estado === "disponible",
        };
      }),
    };
  });

  app.put("/api/mcp-catalog/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = getCatalogEntry(id);
    if (!entry) return reply.code(404).send({ error: "no existe esa entrada en la biblioteca de MCP" });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // Defensa en profundidad: aunque alguien fuerce la llamada, nunca se activa algo no disponible.
    if (parsed.data.activo && entry.estado !== "disponible") {
      return reply.code(400).send({ error: `"${entry.nombre}" todavía no está disponible (estado: ${entry.estado}).` });
    }

    const cfg = await loadConfig();
    const lista = cfg.mcpServers ?? [];
    const existente = lista.find((s) => s.id === id);
    const siguiente: McpServerConfig = {
      id,
      activo: parsed.data.activo,
      env: { ...existente?.env, ...parsed.data.env },
    };
    cfg.mcpServers = [...lista.filter((s) => s.id !== id), siguiente];
    await saveConfig(cfg);

    // La próxima vez que el chat pida tools, que reconecte con la config nueva (clave añadida, etc.).
    resetMcpConnection(id);

    return { ok: true };
  });
}
