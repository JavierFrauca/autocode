import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Construcción del servidor MCP. Aquí se registran las TOOLS (acciones que el LLM puede invocar) y los
 * RESOURCES (datos que puede leer). Es el ÚNICO sitio con lógica del servidor; los dos transportes
 * (stdio.ts y http.ts) solo lo conectan a un canal. El agente añade aquí las tools/resources reales.
 *
 * Reglas de oro MCP:
 *  - Cada tool: `inputSchema` con Zod (validación + descripción de cada campo) y un handler async.
 *  - Devuelve SIEMPRE `{ content: [{ type: "text", text }] }` (usa `asText`); errores con `isError: true`.
 *  - En stdio NO escribas a stdout (rompe el protocolo): los logs van a stderr.
 */

/** Respuesta de texto estándar de una tool MCP. */
const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
/** Respuesta de error de una tool MCP. */
const asError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

export function buildServer(): McpServer {
  const server = new McpServer({ name: "mcp-server", version: "1.0.0" });

  // ── TOOL de ejemplo (reemplázala/añade las del dominio) ──────────────────────────────────────
  server.registerTool(
    "sumar",
    {
      description: "Suma dos números y devuelve el resultado.",
      inputSchema: {
        a: z.number().describe("Primer sumando"),
        b: z.number().describe("Segundo sumando"),
      },
    },
    async ({ a, b }) => asText({ resultado: a + b }),
  );

  server.registerTool(
    "saludar",
    {
      description: "Devuelve un saludo para el nombre dado.",
      inputSchema: { nombre: z.string().min(1).describe("Nombre a saludar") },
    },
    async ({ nombre }) => {
      if (!nombre.trim()) return asError("El nombre no puede estar vacío.");
      return asText(`¡Hola, ${nombre}!`);
    },
  );

  // ── RESOURCE de ejemplo (datos de solo lectura que el LLM puede consultar) ────────────────────
  server.registerResource(
    "info",
    "info://servidor",
    { description: "Información básica del servidor MCP.", mimeType: "text/plain" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: "Servidor MCP de ejemplo (stdio + HTTP)." }],
    }),
  );

  return server;
}
