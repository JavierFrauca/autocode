import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "@shared";

/**
 * Verifica el cliente MCP genérico en dos capas:
 *  - MECANISMO (`connectEntry`): spawn real por stdio contra un MCP de prueba propio (fixtures/), sin
 *    depender de red ni de ningún paquete de terceros — prueba que el spawn, el listado de tools, el
 *    prefijo por servidor y la llamada a la tool funcionan de verdad.
 *  - POLÍTICA (`getActiveMcpTools`): que el "gate" (solo estado "disponible" + activo=true) se cumple
 *    de verdad, catálogo aparte — se mockea `catalog.ts` para poder probar tanto el camino bloqueado
 *    (pendiente_de_validar) como el permitido (disponible), sin esperar a que el catálogo real tenga
 *    una entrada validada.
 */

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-echo-server.mjs");

const entradaPrueba = (estado: "disponible" | "pendiente_de_validar") => ({
  id: "prueba",
  nombre: "MCP de prueba",
  descripcion: "", ventajas: [], inconvenientes: [],
  estado,
  transport: "stdio" as const,
  command: process.execPath,
  args: [FIXTURE],
});

describe("connectEntry — mecanismo real (spawn + listTools + wrap + prefijo)", () => {
  it("conecta por stdio, prefija las tools por servidor y las puede invocar", async () => {
    const { connectEntry } = await import("../mcp/client.js");
    const conn = await connectEntry(entradaPrueba("disponible"), {});
    try {
      const nombres = conn.tools.map((t) => t.name);
      expect(nombres).toContain("prueba__eco");
      expect(nombres).toContain("prueba__fallar");

      const eco = conn.tools.find((t) => t.name === "prueba__eco")!;
      expect(eco.description).toContain("MCP de prueba"); // el prefijo humano, no solo el técnico
      expect(await eco.run({ texto: "hola" })).toBe("eco: hola");

      const fallar = conn.tools.find((t) => t.name === "prueba__fallar")!;
      const r = await fallar.run({});
      expect(r).toContain("Error de MCP de prueba");
      expect(r).toContain("algo salió mal");
    } finally {
      await conn.client.close();
    }
  }, 20_000);
});

describe("getActiveMcpTools — política de activación (el gate real, no solo la UI)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("../mcp/catalog.js");
  });

  it("una entrada pendiente_de_validar NUNCA se conecta, aunque el usuario la marque activa", async () => {
    vi.doMock("../mcp/catalog.js", () => ({
      getCatalogEntry: (id: string) => (id === "prueba" ? entradaPrueba("pendiente_de_validar") : undefined),
    }));
    const { getActiveMcpTools } = await import("../mcp/client.js");
    const cfg = { mcpServers: [{ id: "prueba", activo: true }] } as unknown as AppConfig;
    expect(await getActiveMcpTools(cfg)).toEqual([]);
  });

  it("activo=false no conecta aunque el estado sea disponible", async () => {
    vi.doMock("../mcp/catalog.js", () => ({
      getCatalogEntry: (id: string) => (id === "prueba" ? entradaPrueba("disponible") : undefined),
    }));
    const { getActiveMcpTools } = await import("../mcp/client.js");
    const cfg = { mcpServers: [{ id: "prueba", activo: false }] } as unknown as AppConfig;
    expect(await getActiveMcpTools(cfg)).toEqual([]);
  });

  it("una entrada que ya no existe en el catálogo se ignora sin romper el turno", async () => {
    vi.doMock("../mcp/catalog.js", () => ({ getCatalogEntry: () => undefined }));
    const { getActiveMcpTools } = await import("../mcp/client.js");
    const cfg = { mcpServers: [{ id: "no-existe", activo: true }] } as unknown as AppConfig;
    await expect(getActiveMcpTools(cfg)).resolves.toEqual([]);
  });

  it("disponible + activo=true SÍ conecta y expone sus tools prefijadas", async () => {
    vi.doMock("../mcp/catalog.js", () => ({
      getCatalogEntry: (id: string) => (id === "prueba" ? entradaPrueba("disponible") : undefined),
    }));
    const { getActiveMcpTools, closeAllMcpConnections } = await import("../mcp/client.js");
    const cfg = { mcpServers: [{ id: "prueba", activo: true }] } as unknown as AppConfig;
    try {
      const tools = await getActiveMcpTools(cfg);
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["prueba__eco", "prueba__fallar"]));
    } finally {
      await closeAllMcpConnections();
    }
  }, 20_000);

  it("sin mcpServers configurados, devuelve una lista vacía sin tocar ningún catálogo", async () => {
    const { getActiveMcpTools } = await import("../mcp/client.js");
    expect(await getActiveMcpTools({} as AppConfig)).toEqual([]);
  });
});
