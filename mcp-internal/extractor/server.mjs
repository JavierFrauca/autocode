// Servidor MCP INTERNO de AutoCode (no forma parte de la biblioteca del usuario en Ajustes): aísla el
// parseo de ficheros NO CONFIABLES (PDF/DOCX/ZIP) en su propio proceso. Si un fichero corrupto o
// malicioso revienta un parser, se lleva por delante ESTE proceso hijo, nunca el proceso principal de
// Electron. Plain JS (sin build): así se puede lanzar igual en dev, en tests y ya empaquetado —
// `mcp-internal/` va como `extraResources` (ver package.json), fuera del asar.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extractText } from "./extract.mjs";

const server = new McpServer({ name: "autocode-extractor", version: "0.1.0" });

server.registerTool(
  "extraer",
  {
    description:
      "Extrae texto de un fichero (PDF, DOCX o ZIP con ficheros dentro) recibido en base64. Aísla el " +
      "parseo de formatos no confiables en este proceso, separado del principal.",
    inputSchema: {
      nombre: z.string().describe("Nombre del fichero, con extensión (decide qué lector usar)."),
      contenidoBase64: z.string().describe("Contenido del fichero codificado en base64."),
    },
  },
  async ({ nombre, contenidoBase64 }) => {
    try {
      const buffer = Buffer.from(contenidoBase64, "base64");
      const texto = await extractText(nombre, buffer);
      return { content: [{ type: "text", text: texto }] };
    } catch (e) {
      return { content: [{ type: "text", text: `No se pudo extraer el contenido: ${e?.message ?? e}` }], isError: true };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
