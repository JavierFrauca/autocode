import path from "node:path";
import { extractInIsolation } from "./mcp/internal-extractor.js";

/**
 * Clasificación y extracción de texto de adjuntos. Puro (sin BD/LLM) para poder testearlo.
 *
 * Los formatos de RIESGO (PDF/DOCX/ZIP — requieren parsers de binarios/comprimidos sobre contenido NO
 * confiable) se delegan al MCP interno de extracción (`mcp-internal/extractor/`), que corre en su PROPIO
 * proceso: un fichero corrupto o malicioso se lleva por delante ese proceso hijo, nunca este. Los
 * formatos triviales (texto plano) se resuelven aquí mismo, sin el coste de un proceso aparte.
 */

export type AttachKind = "resource" | "document";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"]);
const DOC_EXT = new Set([".md", ".txt", ".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html", ".pdf", ".docx", ".zip"]);
const CODE_FENCE = new Set([".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html"]);
const RIESGO = new Set([".pdf", ".docx", ".zip"]);
const MAX_TEXT = 200_000;

/** Dónde va el adjunto por su extensión: imagen→recurso, texto/doc→documento, otro→null. */
export function classify(filename: string): AttachKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "resource";
  if (DOC_EXT.has(ext)) return "document";
  return null;
}

/** Extrae texto/markdown del fichero según su tipo. */
export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (RIESGO.has(ext)) return extractInIsolation(filename, buffer);
  if (ext === ".md" || ext === ".txt") return buffer.toString("utf-8").slice(0, MAX_TEXT);
  if (CODE_FENCE.has(ext)) {
    return "```" + ext.slice(1) + "\n" + buffer.toString("utf-8").slice(0, MAX_TEXT) + "\n```";
  }
  return buffer.toString("utf-8").slice(0, MAX_TEXT);
}
