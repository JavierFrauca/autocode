import { describe, expect, it } from "vitest";
import { buildMapFromScreens, flattenMap, parseMap, serializeMap } from "../screens/map.js";

describe("mapa de pantallas", () => {
  it("parsea la lista anidada en árbol (páginas + modales)", () => {
    const md = "# Mapa\n\n- Pacientes\n  - Nuevo paciente\n  - Confirmar baja (modal)\n- Citas\n  - Nueva cita\n- Ajustes\n";
    const t = parseMap(md);
    expect(t.map((n) => n.slug)).toEqual(["pacientes", "citas", "ajustes"]);
    expect(t[0]!.children.map((n) => n.slug)).toEqual(["nuevo-paciente", "confirmar-baja"]);
    expect(t[0]!.children[0]!.kind).toBe("modal"); // anidado => modal
    expect(t[2]!.kind).toBe("pagina");
  });

  it("flatten da padre y orden", () => {
    const f = flattenMap(parseMap("- A\n  - B\n- C\n"));
    expect(f.find((x) => x.slug === "b")?.parent).toBe("a");
    expect(f.find((x) => x.slug === "a")?.parent).toBe(null);
    expect(f.find((x) => x.slug === "c")?.parent).toBe(null);
  });

  it("serializa y vuelve a parsear sin perder estructura (roundtrip)", () => {
    const t = parseMap("- Pacientes\n  - Nuevo paciente\n- Citas\n  - Nueva cita\n- Ajustes\n");
    const t2 = parseMap(serializeMap(t));
    expect(JSON.stringify(t2)).toBe(JSON.stringify(t));
  });

  it("buildMapFromScreens reconstruye el árbol desde el frontmatter", () => {
    const t = buildMapFromScreens([
      { slug: "pacientes", name: "Pacientes", kind: "pagina", parent: null, order: 0 },
      { slug: "nuevo", name: "Nuevo", kind: "modal", parent: "pacientes", order: 10 },
      { slug: "citas", name: "Citas", kind: "pagina", parent: null, order: 20 },
    ]);
    expect(t.map((n) => n.slug)).toEqual(["pacientes", "citas"]);
    expect(t[0]!.children[0]!.slug).toBe("nuevo");
  });
});
