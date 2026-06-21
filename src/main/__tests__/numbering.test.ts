import { describe, expect, test } from "vitest";
import { computeNextNumber } from "../papers/numbering.js";

describe("computeNextNumber (ancla de numeración de documentos)", () => {
  test("carpeta vacía → empieza en 001 con ancho 3", () => {
    const r = computeNextNumber([], "RN", "reglas");
    expect(r.nextPadded).toBe("001");
    expect(r.next).toBe(1);
    expect(r.width).toBe(3);
    expect(r.prefijoSugerido).toBe("reglas/RN-001-");
    expect(r.existentes).toEqual([]);
  });

  test("toma el máximo + 1 aunque haya huecos y duplicados (el caso editor_sepa)", () => {
    const r = computeNextNumber(
      [
        "reglas/RN-001-editor-sepa.md",
        "reglas/RN-001-propósito-y-uso.md", // duplicado de número
        "reglas/RN-004-validaciones.md",
        "reglas/RN-008-exportación.md",
      ],
      "RN",
      "reglas",
    );
    expect(r.nextPadded).toBe("009");
    expect(r.existentes).toHaveLength(4);
  });

  test("ADR en decisiones, contando el ADR-000 de arquitectura", () => {
    const r = computeNextNumber(
      ["decisiones/ADR-000-arquitectura.md", "decisiones/ADR-001-editor-sepa.md"],
      "ADR",
      "decisiones",
    );
    expect(r.nextPadded).toBe("002");
  });

  test("ignora ficheros de otra carpeta o sin el prefijo", () => {
    const r = computeNextNumber(
      ["reglas/RN-003-x.md", "decisiones/ADR-005-y.md", "reglas/notas.md", "reglas/RNX-002.md"],
      "RN",
      "reglas",
    );
    expect(r.nextPadded).toBe("004");
    expect(r.existentes.map((e) => e.ruta)).toEqual(["reglas/RN-003-x.md"]);
  });

  test("normaliza backslashes de Windows y carpeta con barra final", () => {
    const r = computeNextNumber(["reglas\\RN-002-a.md"], "rn", "reglas/");
    expect(r.folder).toBe("reglas");
    expect(r.prefix).toBe("RN");
    expect(r.nextPadded).toBe("003");
  });

  test("respeta un ancho de relleno mayor si ya se usa (NNNN)", () => {
    const r = computeNextNumber(["reglas/RN-0042-a.md"], "RN", "reglas");
    expect(r.width).toBe(4);
    expect(r.nextPadded).toBe("0043");
  });
});
