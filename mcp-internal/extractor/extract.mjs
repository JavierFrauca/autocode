// Lógica PURA de clasificación/extracción (sin MCP ni stdio) — separada de server.mjs para poder
// testearla importándola directamente (rápido, sin levantar un proceso), igual que hacía
// `attachments-extract.ts` antes de que esto se aislara en su propio proceso.
import path from "node:path";
import AdmZip from "adm-zip";

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"]);
export const DOC_EXT = new Set([".md", ".txt", ".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html", ".pdf", ".docx", ".zip"]);
const CODE_FENCE = new Set([".xml", ".xsd", ".json", ".csv", ".yaml", ".yml", ".html"]);
const MAX_TEXT = 200_000;
const ZIP_MAX_ENTRIES = 200;

export function classify(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "resource";
  if (DOC_EXT.has(ext)) return "document";
  return null;
}

/** Zip-slip: una entrada absoluta o con algún segmento ".." intenta escapar de la carpeta del zip. */
export function isSafeZipEntryPath(rel) {
  const norm = rel.replace(/\\/g, "/");
  return !norm.startsWith("/") && !norm.split("/").includes("..");
}

export async function extractText(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".zip") return extractZipText(buffer);
  if (ext === ".md" || ext === ".txt") return buffer.toString("utf-8").slice(0, MAX_TEXT);
  if (CODE_FENCE.has(ext)) {
    return "```" + ext.slice(1) + "\n" + buffer.toString("utf-8").slice(0, MAX_TEXT) + "\n```";
  }
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const r = await parser.getText();
      return (r?.text ?? "").trim().slice(0, MAX_TEXT) || "(PDF sin texto extraíble)";
    } catch (e) {
      console.error("[extractor] fallo extrayendo PDF:", e?.message ?? e);
      return "(no se pudo leer el PDF)";
    }
  }
  if (ext === ".docx") {
    try {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer });
      return (r?.value ?? "").trim().slice(0, MAX_TEXT) || "(documento vacío)";
    } catch (e) {
      console.error("[extractor] fallo extrayendo docx:", e?.message ?? e);
      return "(no se pudo leer el documento)";
    }
  }
  return buffer.toString("utf-8").slice(0, MAX_TEXT);
}

async function extractZipText(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    console.error("[extractor] no se pudo abrir el archivo comprimido:", e?.message ?? e);
    return "(no se pudo abrir el archivo comprimido)";
  }

  const parts = [];
  let procesados = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || procesados >= ZIP_MAX_ENTRIES) continue;
    const rel = entry.entryName.replace(/\\/g, "/");
    if (!isSafeZipEntryPath(rel)) continue;
    if (path.extname(rel).toLowerCase() === ".zip" || classify(rel) !== "document") continue;

    let text;
    try {
      text = await extractText(rel, entry.getData());
    } catch (e) {
      console.error("[extractor] no se pudo extraer un fichero del zip:", rel, e?.message ?? e);
      continue;
    }
    parts.push(`## ${rel}\n\n${text}`);
    procesados++;
  }

  if (!parts.length) return "(el archivo comprimido no contenía ficheros de un tipo reconocido)";
  return parts.join("\n\n---\n\n");
}
