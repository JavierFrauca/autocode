import path from "node:path";
import { log } from "./log.js";

/**
 * Clasificación y extracción de texto de adjuntos. Puro (sin BD/LLM) para poder testearlo.
 */

export type AttachKind = "resource" | "document";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"]);
const DOC_EXT = new Set([".md", ".txt", ".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html", ".pdf", ".docx"]);
const CODE_FENCE = new Set([".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html"]);
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
  if (ext === ".md" || ext === ".txt") return buffer.toString("utf-8").slice(0, MAX_TEXT);
  if (CODE_FENCE.has(ext)) {
    return "```" + ext.slice(1) + "\n" + buffer.toString("utf-8").slice(0, MAX_TEXT) + "\n```";
  }
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new (PDFParse as any)({ data: new Uint8Array(buffer) });
      const r = await parser.getText();
      return ((r?.text ?? "") as string).trim().slice(0, MAX_TEXT) || "(PDF sin texto extraíble)";
    } catch (e: any) {
      log.warn("attachments", "fallo extrayendo PDF", { err: e });
      return "(no se pudo leer el PDF)";
    }
  }
  if (ext === ".docx") {
    try {
      const mammoth: any = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer });
      return ((r?.value ?? "") as string).trim().slice(0, MAX_TEXT) || "(documento vacío)";
    } catch (e: any) {
      log.warn("attachments", "fallo extrayendo docx", { err: e });
      return "(no se pudo leer el documento)";
    }
  }
  return buffer.toString("utf-8").slice(0, MAX_TEXT);
}
