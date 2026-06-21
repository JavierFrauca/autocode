import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

/**
 * Entrada STDIO: el transporte por defecto de MCP. Lo usan clientes como Claude Desktop o Cursor, que
 * LANZAN este proceso y hablan por stdin/stdout. IMPORTANTE: en stdio NO se puede escribir a stdout
 * (es el canal del protocolo) → los logs van a stderr (`console.error`).
 *
 * Registro en Claude Desktop (claude_desktop_config.json):
 *   { "mcpServers": { "mi-servidor": { "command": "node", "args": ["RUTA/dist/stdio.js"] } } }
 */
const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] servidor stdio listo");
