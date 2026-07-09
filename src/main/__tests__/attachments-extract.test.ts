import { afterAll, describe, expect, test } from "vitest";
import AdmZip from "adm-zip";
import { classify, extractText } from "../attachments-extract.js";
import { closeInternalExtractor } from "../mcp/internal-extractor.js";

/**
 * `classify` y los formatos TRIVIALES (md/txt/xsd/json…) se resuelven en este mismo proceso — se prueban
 * aquí igual que siempre. Los formatos de RIESGO (pdf/docx/zip) ahora delegan en el MCP interno de
 * extracción (proceso aparte, `mcp-internal/extractor/`): aquí se prueba la DELEGACIÓN real (que el
 * dispatcher enruta bien y el resultado vuelve correcto); la lógica pura de extracción/zip-slip que corre
 * DENTRO de ese proceso se prueba aparte, más rápido, en mcp-internal-extractor.test.ts.
 */

afterAll(async () => {
  await closeInternalExtractor();
});

describe("classify", () => {
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

describe("extractText — formatos triviales (resueltos en este proceso)", () => {
  test("md/txt se devuelven tal cual", async () => {
    expect(await extractText("n.md", Buffer.from("# Hola\ntexto"))).toBe("# Hola\ntexto");
  });
  test("estructurados se envuelven en bloque de código con el lenguaje", async () => {
    const r = await extractText("schema.xsd", Buffer.from("<xs:schema/>"));
    expect(r.startsWith("```xsd\n")).toBe(true);
    expect(r.trimEnd().endsWith("```")).toBe(true);
    expect(r).toContain("<xs:schema/>");
  });
  test("json igualmente", async () => {
    const r = await extractText("d.json", Buffer.from('{"a":1}'));
    expect(r).toContain("```json");
    expect(r).toContain('{"a":1}');
  });
});

describe("extractText — formatos de RIESGO delegan de verdad en el proceso aislado", () => {
  test("un .zip se descomprime en el proceso aparte y el resultado vuelve completo", async () => {
    const zip = new AdmZip();
    zip.addFile("esquema.xsd", Buffer.from("<xs:schema/>"));
    zip.addFile("notas.md", Buffer.from("# Notas\ncontenido"));
    const r = await extractText("bundle.zip", zip.toBuffer());
    expect(r).toContain("## esquema.xsd");
    expect(r).toContain("<xs:schema/>");
    expect(r).toContain("## notas.md");
  }, 20_000);

  test("un .pdf que no es un PDF real vuelve con el mensaje de fallo controlado (no revienta este proceso)", async () => {
    const r = await extractText("falso.pdf", Buffer.from("esto no es un PDF real"));
    expect(r).toContain("no se pudo leer el PDF");
  }, 20_000);
});
