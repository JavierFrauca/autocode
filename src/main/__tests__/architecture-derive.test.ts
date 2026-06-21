import { describe, expect, test } from "vitest";
import { deriveAppType } from "../architecture-derive.js";

describe("deriveAppType", () => {
  test("línea canónica **Tipo:** manda sobre el resto del texto", () => {
    expect(deriveAppType("blah web web web\n\n**Tipo:** escritorio\nmás texto")).toBe("electron");
    expect(deriveAppType("escritorio escritorio\n\n**Tipo:** web\n")).toBe("server");
  });

  test("variantes de la línea Tipo", () => {
    expect(deriveAppType("- Tipo de aplicación: escritorio")).toBe("electron");
    expect(deriveAppType("Tipo: Web (navegador)")).toBe("server");
  });

  test("heurística por el texto cuando no hay línea Tipo", () => {
    expect(deriveAppType("La usará una persona, instalada en su ordenador.")).toBe("electron");
    expect(deriveAppType("Varias personas a la vez desde distintos sitios.")).toBe("server");
  });

  test("por defecto: web", () => {
    expect(deriveAppType("texto sin pistas claras")).toBe("server");
    expect(deriveAppType("")).toBe("server");
  });

  test("detecta MCP (y gana a 'servidor', que contiene)", () => {
    expect(deriveAppType("**Tipo:** servidor MCP")).toBe("mcp");
    expect(deriveAppType("- Tipo: MCP")).toBe("mcp");
    expect(deriveAppType("Quiero un Model Context Protocol server con tools")).toBe("mcp");
  });

  test("detecta servicio API / integración (sin interfaz)", () => {
    expect(deriveAppType("**Tipo:** api")).toBe("api");
    expect(deriveAppType("- Tipo: servicio API")).toBe("api");
    expect(deriveAppType("Un servicio que recibe webhooks y sincroniza, sin pantallas")).toBe("api");
    // web normal NO debe confundirse con api por mencionar pantallas
    expect(deriveAppType("**Tipo:** web")).toBe("server");
  });
});
