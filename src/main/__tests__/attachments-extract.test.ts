import { describe, expect, test } from "vitest";
import { classify, extractText } from "../attachments-extract.js";

describe("classify", () => {
  test("imágenes → recurso", () => {
    for (const f of ["logo.png", "foto.JPG", "icono.svg", "x.webp"]) expect(classify(f)).toBe("resource");
  });
  test("texto/estructurado/documento → documento", () => {
    for (const f of ["spec.xsd", "datos.json", "notas.md", "informe.pdf", "contrato.docx", "a.txt"])
      expect(classify(f)).toBe("document");
  });
  test("tipo no soportado → null", () => {
    expect(classify("app.zip")).toBeNull();
    expect(classify("video.mp4")).toBeNull();
  });
});

describe("extractText", () => {
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
