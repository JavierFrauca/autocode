import { existsSync } from "node:fs";
import path from "node:path";
import { app as electronApp } from "electron";
import { connectEntry } from "./client.js";
import { log } from "../log.js";

/**
 * Cliente del MCP INTERNO de extracción (`mcp-internal/extractor/server.mjs`): aísla el parseo de
 * PDF/DOCX/ZIP —formatos no confiables— en su propio proceso, para que un fichero corrupto o malicioso
 * se lleve por delante ESE proceso hijo, nunca el principal de Electron. No es una entrada de la
 * biblioteca del usuario (`mcp/catalog.ts`): es infraestructura interna, siempre disponible, sin toggle
 * en Ajustes — por eso conecta directamente con `connectEntry`, sin pasar por el gate de activación.
 */

let conn: Awaited<ReturnType<typeof connectEntry>> | null = null;
let connecting: Promise<Awaited<ReturnType<typeof connectEntry>>> | null = null;

/** Busca `mcp-internal/extractor/server.mjs` subiendo desde aquí (funciona en fuente, compilado o test). */
function findServerScript(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "mcp-internal", "extractor", "server.mjs");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Empaquetado: mcp-internal/ va como extraResources, fuera del asar (ver package.json → build.extraResources).
  if (electronApp?.isPackaged) {
    const packaged = path.join(process.resourcesPath, "mcp-internal", "extractor", "server.mjs");
    if (existsSync(packaged)) return packaged;
  }
  throw new Error("no se encontró mcp-internal/extractor/server.mjs");
}

async function ensureConnected(): Promise<Awaited<ReturnType<typeof connectEntry>>> {
  if (conn) return conn;
  if (!connecting) {
    connecting = connectEntry(
      {
        id: "extractor-interno",
        nombre: "Extractor de ficheros (interno)",
        descripcion: "", ventajas: [], inconvenientes: [], estado: "disponible",
        transport: "stdio",
        command: process.execPath,
        args: [findServerScript()],
      },
      { ELECTRON_RUN_AS_NODE: "1" }, // no-op bajo Node normal; necesario para spawnear como Node dentro de Electron
    ).finally(() => { connecting = null; });
  }
  conn = await connecting;
  return conn;
}

/**
 * Extrae texto de un fichero de riesgo (PDF/DOCX/ZIP) en el proceso aislado. Best-effort: si el proceso
 * hijo falla o no arranca, se reintenta UNA vez con una conexión nueva (por si el proceso anterior murió)
 * antes de rendirse con un mensaje en lenguaje llano.
 */
export async function extractInIsolation(nombre: string, buffer: Buffer): Promise<string> {
  const contenidoBase64 = buffer.toString("base64");
  for (let intento = 0; intento < 2; intento++) {
    try {
      const c = await ensureConnected();
      const tool = c.tools.find((t) => t.name === "extractor_interno__extraer");
      if (!tool) throw new Error("el extractor interno no expuso la tool esperada");
      return await tool.run({ nombre, contenidoBase64 });
    } catch (e) {
      log.warn("mcp", "fallo en el extractor interno, reintentando con conexión nueva", { err: e, intento });
      await closeInternalExtractor();
    }
  }
  return "(no se pudo leer el fichero: el extractor interno no está disponible ahora mismo)";
}

/** Cierra la conexión (al apagar la app, o para forzar reconexión tras un fallo). */
export async function closeInternalExtractor(): Promise<void> {
  const c = conn;
  conn = null;
  if (c) await c.client.close().catch(() => {});
}
