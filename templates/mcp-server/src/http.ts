import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

/**
 * Entrada HTTP: expone el MCP por red (transporte Streamable HTTP) en POST /mcp. Modo SIN sesión
 * (stateless): cada petición construye su propio servidor+transporte. Útil para clientes remotos o
 * para integrarlo en una infraestructura web. Para producción, pon esto detrás de TLS y auth.
 */

const PORT = Number(process.env.PORT ?? 3000);

/** Lee el cuerpo de la petición y lo parsea como JSON (el transporte usa el body ya parseado). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

const httpServer = createServer(async (req, res) => {
  if (req.url?.split("?")[0] !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "MCP (stateless) requiere POST en /mcp" }));
    return;
  }

  const body = await readJsonBody(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e: unknown) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  }
});

httpServer.listen(PORT, () => console.error(`[mcp] servidor HTTP en http://localhost:${PORT}/mcp`));
