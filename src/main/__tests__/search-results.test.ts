import { describe, expect, test } from "vitest";
import { parseSearchResults } from "../mcp/search-results.js";

describe("parseSearchResults", () => {
  test("parsea el formato real de open-websearch", () => {
    const raw = JSON.stringify({
      query: "algo",
      results: [
        { title: "Título <b>resaltado</b>", url: "https://example.com/a", description: "Una <b>descripción</b> larga.", source: "example.com" },
        { url: "https://example.com/b" },
      ],
    });
    const r = parseSearchResults(raw);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ titulo: "Título resaltado", url: "https://example.com/a", descripcion: "Una descripción larga." });
    // Sin título en la fuente → usa la URL como título (y sin descripción → cadena vacía).
    expect(r[1]).toEqual({ titulo: "https://example.com/b", url: "https://example.com/b", descripcion: "" });
  });

  test("ignora resultados sin url", () => {
    const raw = JSON.stringify({ results: [{ title: "Sin url" }, { title: "Con url", url: "https://x.com" }] });
    expect(parseSearchResults(raw)).toEqual([{ titulo: "Con url", url: "https://x.com", descripcion: "" }]);
  });

  test("texto no-JSON → lista vacía, no lanza excepción", () => {
    expect(parseSearchResults("esto no es JSON")).toEqual([]);
  });

  test("JSON válido sin `results` → lista vacía", () => {
    expect(parseSearchResults(JSON.stringify({ ok: true }))).toEqual([]);
  });
});
