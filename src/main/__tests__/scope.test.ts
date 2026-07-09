import { describe, expect, test } from "vitest";
import {
  computeScope, dedupeEntidades, formatScopeForChat, hasAuthSectionContent, hasDbEngineSectionContent,
  hasMultiTenantSectionContent, looksLikeRolesDoc, normalizeEntitySlug, type ScopeInventory,
} from "../agents/scope.js";

/** Inventario base (vacío) que cada test va completando. */
function emptyInv(appType: ScopeInventory["appType"]): ScopeInventory {
  return {
    appType,
    architectureConfirmed: !!appType,
    hasAuthSection: false,
    hasRolesDoc: false,
    hasDbEngineDecision: false,
    hasMultiTenantDecision: false,
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

  test("web: incluye acceso, roles, multiempresa, motor de datos y pantallas como piezas requeridas", () => {
    const r = computeScope(emptyInv("server"));
    expect(r.items.some((i) => i.key === "auth")).toBe(true);
    expect(r.items.some((i) => i.key === "roles")).toBe(true);
    expect(r.items.some((i) => i.key === "multiempresa")).toBe(true);
    expect(r.items.some((i) => i.key === "motor-datos")).toBe(true);
    expect(r.items.some((i) => i.key === "pantallas")).toBe(true);
  });

  test("api: sin pantallas, auth de usuario, roles ni multiempresa; sí datos, motor de BBDD y reglas", () => {
    const r = computeScope(emptyInv("api"));
    expect(r.items.some((i) => i.key === "pantallas")).toBe(false);
    expect(r.items.some((i) => i.key === "auth")).toBe(false);
    expect(r.items.some((i) => i.key === "roles")).toBe(false);
    expect(r.items.some((i) => i.key === "multiempresa")).toBe(false);
    expect(r.items.some((i) => i.key === "motor-datos")).toBe(true);
    expect(r.items.some((i) => i.key === "modelo-datos")).toBe(true);
    expect(r.items.some((i) => i.key === "reglas")).toBe(true);
  });

  test("mcp: sin pantallas, auth, roles, multiempresa ni motor de datos; sí datos y reglas", () => {
    const r = computeScope(emptyInv("mcp"));
    expect(r.items.some((i) => i.key === "pantallas")).toBe(false);
    expect(r.items.some((i) => i.key === "auth")).toBe(false);
    expect(r.items.some((i) => i.key === "roles")).toBe(false);
    expect(r.items.some((i) => i.key === "multiempresa")).toBe(false);
    expect(r.items.some((i) => i.key === "motor-datos")).toBe(false);
    expect(r.items.some((i) => i.key === "modelo-datos")).toBe(true);
    expect(r.items.some((i) => i.key === "reglas")).toBe(true);
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
      hasDbEngineDecision: true,
      hasMultiTenantDecision: true,
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

describe("normalizeEntitySlug (para deduplicar entidades de dominios/)", () => {
  test("singular y plural normalizan igual", () => {
    expect(normalizeEntitySlug("cliente")).toBe(normalizeEntitySlug("clientes"));
    expect(normalizeEntitySlug("factura")).toBe(normalizeEntitySlug("facturas"));
  });

  test("acentos y guiones no cambian la identidad de la entidad", () => {
    expect(normalizeEntitySlug("línea-pedido")).toBe(normalizeEntitySlug("linea_pedido"));
  });

  test("palabras cortas no se les quita la 's' final (no son plurales largos)", () => {
    expect(normalizeEntitySlug("gas")).toBe("gas");
  });
});

describe("dedupeEntidades (colapsa ficheros de dominio que son la misma entidad)", () => {
  test("cliente.md y clientes.md cuentan como UNA sola entidad", () => {
    const out = dedupeEntidades(["cliente", "clientes", "factura"]);
    expect(out).toHaveLength(2);
    expect(out).toContain("cliente");
    expect(out).toContain("factura");
  });

  test("sin duplicados, no cambia nada", () => {
    expect(dedupeEntidades(["cliente", "producto", "pedido"])).toHaveLength(3);
  });
});

describe("looksLikeRolesDoc (detección por CONTENIDO, no por nombre de fichero)", () => {
  test("encabezado de roles/permisos → true", () => {
    expect(looksLikeRolesDoc("# ADR-002\n\n## Roles y permisos\n\nAdministrador: todo.")).toBe(true);
  });

  test("tabla de permisos con la palabra rol → true", () => {
    expect(looksLikeRolesDoc("# ADR-003\n\n| Rol | Puede borrar |\n|---|---|\n| Admin | Sí |")).toBe(true);
  });

  test("ADR sin nada de roles → false", () => {
    expect(looksLikeRolesDoc("# ADR-000: Arquitectura\n\n## Decisiones técnicas\n**Tipo:** web")).toBe(false);
  });
});

describe("hasAuthSectionContent (exige contenido real, no solo el encabezado)", () => {
  test("encabezado con la línea canónica de proveedores → true", () => {
    expect(hasAuthSectionContent("## Autenticación\n**Proveedores:** propio\n**Registro de accesos:** sí")).toBe(true);
  });

  test("encabezado VACÍO (sin línea de proveedores) → false", () => {
    expect(hasAuthSectionContent("## Autenticación\n")).toBe(false);
  });

  test("sin sección de Autenticación → false", () => {
    expect(hasAuthSectionContent("## Decisiones técnicas\n**Tipo:** web")).toBe(false);
  });
});

describe("hasDbEngineSectionContent (exige contenido real, no solo el encabezado)", () => {
  test("encabezado con la línea canónica de motor → true", () => {
    expect(hasDbEngineSectionContent("## Base de datos\n**Motor:** postgres\n**Motivo:** alta concurrencia")).toBe(true);
  });

  test("encabezado VACÍO (sin línea de motor) → false", () => {
    expect(hasDbEngineSectionContent("## Base de datos\n")).toBe(false);
  });

  test("sin sección de Base de datos → false", () => {
    expect(hasDbEngineSectionContent("## Decisiones técnicas\n**Tipo:** web")).toBe(false);
  });
});

describe("hasMultiTenantSectionContent (basta la línea canónica, sin encabezado fijo)", () => {
  test("línea 'Multiempresa: sí' dentro de Decisiones técnicas → true", () => {
    expect(hasMultiTenantSectionContent("## Decisiones técnicas\n**Tipo:** web\n**Multiempresa:** sí")).toBe(true);
  });

  test("línea 'Multiempresa: no' también cuenta como decisión tomada → true", () => {
    expect(hasMultiTenantSectionContent("## Multiempresa\n**Multiempresa:** no")).toBe(true);
  });

  test("sin la línea canónica → false", () => {
    expect(hasMultiTenantSectionContent("## Decisiones técnicas\n**Tipo:** web")).toBe(false);
  });
});
