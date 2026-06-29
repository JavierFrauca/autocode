import { describe, expect, test } from "vitest";
import { computeScope, formatScopeForChat, type ScopeInventory } from "../agents/scope.js";

/** Inventario base (vacío) que cada test va completando. */
function emptyInv(appType: ScopeInventory["appType"]): ScopeInventory {
  return {
    appType,
    architectureConfirmed: !!appType,
    hasAuthSection: false,
    hasRolesDoc: false,
    entidades: [],
    screenCount: 0,
    reglasCount: 0,
  };
}

describe("computeScope (motor de completitud del alcance)", () => {
  test("sin arquitectura → el primer hueco es la arquitectura", () => {
    const r = computeScope(emptyInv(null));
    expect(r.appType).toBeNull();
    expect(r.closed).toBe(false);
    expect(r.items[0].key).toBe("arquitectura");
    expect(r.items[0].status).toBe("missing");
    expect(r.nextQuestion).toBe(r.items[0].question);
  });

  test("escritorio: pide modelo de datos antes que nada cuando ya hay arquitectura; sin auth/roles", () => {
    const r = computeScope(emptyInv("electron"));
    expect(r.items.find((i) => i.key === "arquitectura")?.status).toBe("ok");
    expect(r.items.some((i) => i.key === "auth")).toBe(false);
    expect(r.items.some((i) => i.key === "roles")).toBe(false);
    expect(r.items.find((i) => i.status !== "ok")?.key).toBe("modelo-datos");
  });

  test("web: incluye acceso, roles y pantallas como piezas requeridas", () => {
    const r = computeScope(emptyInv("server"));
    expect(r.items.some((i) => i.key === "auth")).toBe(true);
    expect(r.items.some((i) => i.key === "roles")).toBe(true);
    expect(r.items.some((i) => i.key === "pantallas")).toBe(true);
  });

  test("api/mcp: sin pantallas, auth de usuario ni roles; sí datos y reglas", () => {
    for (const t of ["api", "mcp"] as const) {
      const r = computeScope(emptyInv(t));
      expect(r.items.some((i) => i.key === "pantallas")).toBe(false);
      expect(r.items.some((i) => i.key === "auth")).toBe(false);
      expect(r.items.some((i) => i.key === "roles")).toBe(false);
      expect(r.items.some((i) => i.key === "modelo-datos")).toBe(true);
      expect(r.items.some((i) => i.key === "reglas")).toBe(true);
    }
  });

  test("la estructura de pantallas (mapa) cuenta como cubierta si hay screens", () => {
    const inv = emptyInv("electron");
    inv.entidades = ["cliente"];
    inv.screenCount = 3;
    const r = computeScope(inv);
    expect(r.items.find((i) => i.key === "pantallas")?.status).toBe("ok");
  });

  test("sin screens en el mapa → pantallas missing", () => {
    const r = computeScope(emptyInv("server"));
    expect(r.items.find((i) => i.key === "pantallas")?.status).toBe("missing");
  });

  test("proyecto web completo → closed=true y cobertura 100%", () => {
    const inv: ScopeInventory = {
      appType: "server",
      architectureConfirmed: true,
      hasAuthSection: true,
      hasRolesDoc: true,
      entidades: ["cliente"],
      screenCount: 4,
      reglasCount: 2,
    };
    const r = computeScope(inv);
    expect(r.closed).toBe(true);
    expect(r.coverage).toBe(1);
    expect(r.nextQuestion).toBeNull();
  });

  test("formatScopeForChat incluye el porcentaje y el siguiente hueco", () => {
    const r = computeScope(emptyInv("electron"));
    const txt = formatScopeForChat(r);
    expect(txt).toContain("ESTADO DE COBERTURA");
    expect(txt).toContain("SIGUIENTE HUECO");
    expect(txt).toContain("Qué datos maneja");
  });
});
