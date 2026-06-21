import { describe, expect, test } from "vitest";
import { isDocPath } from "../papers/ingest.js";

describe("allowlist de documentos indexables (isDocPath)", () => {
  test("acepta documentos de las carpetas permitidas", () => {
    expect(isDocPath("decisiones/ADR-000-arquitectura.md")).toBe(true);
    expect(isDocPath("reglas/RN-001-validaciones.md")).toBe(true);
    expect(isDocPath("pantallas/principal.md")).toBe(true);
    expect(isDocPath("aportados/DOC-spec.md")).toBe(true);
    expect(isDocPath("patrones/componentes/Boton.md")).toBe(true);
    expect(isDocPath("tecnicos/DT-001-formato-cotizacion.md")).toBe(true);
  });

  test("la fuente CRUDA de un documento técnico (*.fuente.md) NO se indexa (artefacto recuperable)", () => {
    expect(isDocPath("tecnicos/DT-001-formato-cotizacion.fuente.md")).toBe(false);
    // pero el paper destilado hermano sí
    expect(isDocPath("tecnicos/DT-001-formato-cotizacion.md")).toBe(true);
  });

  test("RECHAZA código generado, dependencias e internos (la causa del corpus de 900K)", () => {
    expect(isDocPath("_app/node_modules/vite/LICENSE.md")).toBe(false);
    expect(isDocPath("_app/src/index.ts.md")).toBe(false);
    expect(isDocPath("node_modules/x/README.md")).toBe(false);
    expect(isDocPath("_historial/sess.json")).toBe(false);
    expect(isDocPath("planes/plan.md")).toBe(false);
    expect(isDocPath("media/logo.md")).toBe(false);
    expect(isDocPath("build/out.md")).toBe(false);
  });

  test("rechaza no-markdown y rutas con backslashes Windows", () => {
    expect(isDocPath("reglas/RN.txt")).toBe(false);
    expect(isDocPath("reglas\\RN-001.md")).toBe(true); // normaliza backslashes
  });
});
