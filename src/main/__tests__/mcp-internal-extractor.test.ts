import { describe, expect, test } from "vitest";
import AdmZip from "adm-zip";
import { classify, extractText, isSafeZipEntryPath } from "../../../mcp-internal/extractor/extract.mjs";

/**
 * Lógica PURA del MCP interno de extracción (PDF/DOCX/ZIP) — se importa directamente (sin levantar el
 * proceso MCP) para poder testearla rápido, igual que antes de aislarla en su propio proceso. El
 * spawn/IPC real (server.mjs vía `extractInIsolation`) se verifica aparte en attachments-extract.test.ts.
 */

describe("classify (mcp-internal/extractor)", () => {
  test("imágenes → recurso", () => {
    for (const f of ["logo.png", "foto.JPG", "icono.svg", "x.webp"]) expect(classify(f)).toBe("resource");
  });
  test("texto/estructurado/documento/zip → documento", () => {
    for (const f of ["spec.xsd", "datos.json", "notas.md", "informe.pdf", "contrato.docx", "a.txt", "bundle.zip"])
      expect(classify(f)).toBe("document");
  });
  test("tipo no soportado → null", () => {
    expect(classify("video.mp4")).toBeNull();
  });
});

describe("extractText — formatos triviales y estructurados", () => {
  test("md/txt se devuelven tal cual", async () => {
    expect(await extractText("n.md", Buffer.from("# Hola\ntexto"))).toBe("# Hola\ntexto");
  });
  test("estructurados se envuelven en bloque de código con el lenguaje", async () => {
    const r = await extractText("schema.xsd", Buffer.from("<xs:schema/>"));
    expect(r.startsWith("```xsd\n")).toBe(true);
    expect(r.trimEnd().endsWith("```")).toBe(true);
    expect(r).toContain("<xs:schema/>");
  });
});

describe("extractText — zip (procesa cada fichero interno por su tipo, uno a uno)", () => {
  test("descomprime y extrae cada entrada reconocida como su propia sección", async () => {
    const zip = new AdmZip();
    zip.addFile("esquema.xsd", Buffer.from("<xs:schema/>"));
    zip.addFile("notas.md", Buffer.from("# Notas\ncontenido"));
    zip.addFile("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await extractText("bundle.zip", zip.toBuffer());
    expect(r).toContain("## esquema.xsd");
    expect(r).toContain("<xs:schema/>");
    expect(r).toContain("## notas.md");
    expect(r).not.toContain("logo.png");
  });

  test("zip vacío o sin ficheros reconocidos → mensaje claro, no revienta", async () => {
    const zip = new AdmZip();
    zip.addFile("foto.jpg", Buffer.from([0xff, 0xd8]));
    const r = await extractText("bundle.zip", zip.toBuffer());
    expect(r).toContain("no contenía ficheros de un tipo reconocido");
  });

  test("zip corrupto → mensaje claro, no lanza excepción", async () => {
    const r = await extractText("roto.zip", Buffer.from("esto no es un zip válido"));
    expect(r).toContain("no se pudo abrir");
  });
});

describe("isSafeZipEntryPath (zip-slip)", () => {
  test("rutas normales son seguras", () => {
    expect(isSafeZipEntryPath("esquema.xsd")).toBe(true);
    expect(isSafeZipEntryPath("carpeta/fichero.md")).toBe(true);
  });
  test("rutas absolutas o con '..' se rechazan", () => {
    expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeZipEntryPath("../../evil.txt")).toBe(false);
    expect(isSafeZipEntryPath("carpeta/../../evil.txt")).toBe(false);
    expect(isSafeZipEntryPath("..\\..\\evil.txt")).toBe(false);
  });
});
