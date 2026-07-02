import { describe, expect, test } from "vitest";
import { displayName, findOneSidedRelations } from "../agents/domain-relations.js";

describe("displayName", () => {
  test("capitaliza y separa guiones/underscores", () => {
    expect(displayName("cliente")).toBe("Cliente");
    expect(displayName("linea-pedido")).toBe("Linea Pedido");
    expect(displayName("linea_pedido")).toBe("Linea Pedido");
  });
});

describe("findOneSidedRelations", () => {
  test("relación recíproca (ambos ficheros se mencionan) → sin avisos", () => {
    const entities = [
      { slug: "cliente", body: "# Cliente\n\n## Campos\n- nombre\n\n## Relaciones\n- Un Cliente tiene varios Pedidos.\n" },
      { slug: "pedido", body: "# Pedido\n\n## Campos\n- fecha\n\n## Relaciones\n- Un Pedido pertenece a un Cliente.\n" },
    ];
    expect(findOneSidedRelations(entities)).toEqual([]);
  });

  test("relación en un solo sentido → aviso", () => {
    const entities = [
      { slug: "cliente", body: "# Cliente\n\n## Campos\n- nombre\n" },
      { slug: "pedido", body: "# Pedido\n\n## Campos\n- fecha\n\n## Relaciones\n- Un Pedido pertenece a un Cliente.\n" },
    ];
    const warnings = findOneSidedRelations(entities);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].desde).toBe("Pedido");
    expect(warnings[0].hacia).toBe("Cliente");
    expect(warnings[0].mensaje).toContain("Pedido");
    expect(warnings[0].mensaje).toContain("Cliente");
  });

  test("sin sección de Relaciones → no revienta y no avisa", () => {
    const entities = [
      { slug: "cliente", body: "# Cliente\n\n## Campos\n- nombre\n" },
      { slug: "producto", body: "# Producto\n\n## Campos\n- precio\n" },
    ];
    expect(findOneSidedRelations(entities)).toEqual([]);
  });

  test("una sola entidad → sin avisos (no hay con quién relacionarse)", () => {
    const entities = [{ slug: "cliente", body: "# Cliente\n\n## Relaciones\n- Ninguna todavía.\n" }];
    expect(findOneSidedRelations(entities)).toEqual([]);
  });
});
