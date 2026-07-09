import { describe, expect, test } from "vitest";
import { stripDiagramSection } from "../agents/agent-tools.js";

/**
 * `stripDiagramSection` es la parte PURA de la tool `listar_dominios` (recorta el Mermaid, deja
 * Campos+Relaciones) — se testea sola porque el resto de la tool necesita un proyecto real en BD
 * (`resolveProjectRoot`), igual que el resto de tools de agente.
 */
describe("stripDiagramSection", () => {
  test("quita la sección ## Diagrama y deja lo anterior intacto", () => {
    const body = [
      "# Cliente",
      "",
      "## Campos",
      "- nombre — texto (obligatorio)",
      "",
      "## Relaciones",
      "- Un Cliente tiene varios Pedidos (1→N).",
      "",
      "## Diagrama",
      "```mermaid",
      "erDiagram",
      "  CLIENTE ||--o{ PEDIDO : tiene",
      "```",
    ].join("\n");
    const r = stripDiagramSection(body);
    expect(r).toContain("## Campos");
    expect(r).toContain("## Relaciones");
    expect(r).toContain("Un Cliente tiene varios Pedidos");
    expect(r).not.toContain("## Diagrama");
    expect(r).not.toContain("erDiagram");
  });

  test("sin sección de diagrama, devuelve el cuerpo tal cual (recortado de espacios)", () => {
    const body = "# Cliente\n\n## Campos\n- nombre\n";
    expect(stripDiagramSection(body)).toBe("# Cliente\n\n## Campos\n- nombre");
  });
});
