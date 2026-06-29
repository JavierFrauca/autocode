import { describe, expect, it } from "vitest";
import { extractJson } from "../llm/json.js";

describe("extractJson", () => {
  it("parsea JSON puro", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("quita fence ```json", () => {
    const raw = "Aquí tienes:\n```json\n{\"a\": 1}\n```\n¡Gracias!";
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("quita fence sin lenguaje", () => {
    expect(extractJson("```\n{\"a\": 1}\n```")).toEqual({ a: 1 });
  });

  it("repara saltos de línea CRUDOS dentro de strings (error típico de modelos pequeños)", () => {
    const raw = '{"ficheros":[{"ruta":"dominios/cliente.md","contenido":"# Cliente\n\n## Campos\n- nombre"}]}';
    const out = extractJson<{ ficheros: { ruta: string; contenido: string }[] }>(raw);
    expect(out.ficheros[0].ruta).toBe("dominios/cliente.md");
    expect(out.ficheros[0].contenido).toContain("# Cliente");
    expect(out.ficheros[0].contenido).toContain("## Campos");
  });

  it("encuentra objeto suelto entre texto", () => {
    const raw = "Respuesta: {\"changes\": [{\"path\":\"a.md\"}]} listo.";
    expect(extractJson(raw)).toEqual({ changes: [{ path: "a.md" }] });
  });

  it("tolera coma final", () => {
    expect(extractJson("{\"a\": 1,}")).toEqual({ a: 1 });
    expect(extractJson("[1,2,3,]")).toEqual([1, 2, 3]);
  });

  it("tolera comentarios //", () => {
    const raw = "{\n  // esto es a\n  \"a\": 1\n}";
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("tolera comentarios /* */", () => {
    const raw = "{ /* esto es a */ \"a\": 1 }";
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("lanza error si no hay JSON", () => {
    expect(() => extractJson("hola, no hay nada útil")).toThrow();
    expect(() => extractJson("")).toThrow();
  });

  it("respeta llaves dentro de strings", () => {
    const raw = '{"name": "código { con llaves }"}';
    expect(extractJson(raw)).toEqual({ name: "código { con llaves }" });
  });
});
