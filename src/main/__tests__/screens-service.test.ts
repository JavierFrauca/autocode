import { describe, expect, test } from "vitest";
import { formatMockupHistoryEntry, mockupHistoryPathFor } from "../screens/service.js";

/**
 * Verificación OFFLINE de las piezas PURAS de `setMockupHtml` (sin tocar disco/BD): el formato del
 * historial que archiva la maqueta anterior con su motivo, y la ruta del fichero de historial.
 */

describe("formatMockupHistoryEntry (archivo de la maqueta anterior con motivo)", () => {
  test("incluye la fecha, el motivo y el HTML anterior en un bloque de código", () => {
    const entry = formatMockupHistoryEntry("el listado necesitaba una columna más por la regla RN-004", "2026-07-08T10:00:00.000Z", "<button>Guardar</button>");
    expect(entry).toContain("## 2026-07-08T10:00:00.000Z");
    expect(entry).toContain("**Motivo:** el listado necesitaba una columna más por la regla RN-004");
    expect(entry).toContain("```html");
    expect(entry).toContain("<button>Guardar</button>");
  });

  test("recorta espacios sobrantes del motivo y del html", () => {
    const entry = formatMockupHistoryEntry("  motivo con espacios  ", "t", "  <p>x</p>  ");
    expect(entry).toContain("**Motivo:** motivo con espacios\n");
    expect(entry).toContain("```html\n<p>x</p>\n```");
  });
});

describe("mockupHistoryPathFor (ruta del sidecar de historial)", () => {
  test("pantallas/x.md → pantallas/x.preview.historial.md", () => {
    expect(mockupHistoryPathFor("pantallas/cliente-lista.md")).toBe("pantallas/cliente-lista.preview.historial.md");
  });
});
