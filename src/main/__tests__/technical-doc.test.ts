import { describe, expect, test } from "vitest";
import { composeTechnicalPaper, technicalDocPaths } from "../attachments-tecnico.js";

describe("documentos técnicos — rutas y composición (puro)", () => {
  test("technicalDocPaths: paper + fuente cruda hermana + título numerado", () => {
    const r = technicalDocPaths("001", "Formato de cotización (Seguridad Social)");
    expect(r.docPath).toBe("tecnicos/DT-001-formato-de-cotizacion-seguridad-social.md");
    // la cruda es el hermano .fuente.md (que isDocPath/buildTree excluyen)
    expect(r.sourcePath).toBe("tecnicos/DT-001-formato-de-cotizacion-seguridad-social.fuente.md");
    expect(r.title).toBe("DT-001: Formato de cotización (Seguridad Social)");
  });

  test("technicalDocPaths: nombre vacío cae a slug 'doc'", () => {
    expect(technicalDocPaths("007", "   ").docPath).toBe("tecnicos/DT-007-doc.md");
  });

  test("composeTechnicalPaper: frontmatter de procedencia + sección Fuente garantizada", () => {
    const out = composeTechnicalPaper({
      title: "DT-001: Esquema X",
      paperBody: "# Esquema X\n\n## Especificación\nCampo A: numérico, 12.",
      source: "https://ejemplo.org/esquema.pdf",
      fechaISO: "2026-06-18T10:00:00.000Z",
    });
    expect(out).toContain("tipo: documento técnico (fuente canónica aportada)");
    expect(out).toContain("origen: https://ejemplo.org/esquema.pdf");
    expect(out).toContain("fecha: 2026-06-18T10:00:00.000Z");
    // el cuerpo del modelo (ya empieza por #) se conserva tal cual
    expect(out).toContain("## Especificación");
    // la trazabilidad la añade el código, no dependemos de que el modelo la ponga
    expect(out).toContain("## Fuente");
    expect(out).toMatch(/- Origen: https:\/\/ejemplo\.org\/esquema\.pdf/);
  });

  test("composeTechnicalPaper: si el cuerpo no empieza por #, antepone el título como H1", () => {
    const out = composeTechnicalPaper({
      title: "DT-002: Norma Y",
      paperBody: "Texto suelto sin encabezado.",
      source: "fichero.pdf",
      fechaISO: "2026-06-18T10:00:00.000Z",
    });
    expect(out).toContain("# DT-002: Norma Y\n\nTexto suelto sin encabezado.");
  });
});
