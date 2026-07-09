// Servidor MCP mínimo usado SOLO como fixture de test (mcp-client.test.ts): registra dos tools de
// prueba y habla por stdio. Deliberadamente en JS plano (sin build) para poder lanzarlo con
// `process.execPath fixture.mjs` directamente desde el test, como haría cualquier MCP real.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-echo-fixture", version: "0.0.1" });

server.registerTool(
  "eco",
  { description: "Devuelve el texto que se le pasa.", inputSchema: { texto: z.string() } },
  async ({ texto }) => ({ content: [{ type: "text", text: `eco: ${texto}` }] }),
);

server.registerTool(
  "fallar",
  { description: "Siempre devuelve un error (para testear el manejo de fallos).", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: "algo salió mal" }], isError: true }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
