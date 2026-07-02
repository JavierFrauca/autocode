import { describe, expect, test } from "vitest";
import { connectEntry } from "../mcp/client.js";
import { getCatalogEntry } from "../mcp/catalog.js";

/**
 * Verificación EN VIVO de una entrada real del catálogo (hoy, "busqueda-web" / open-websearch): lanza el
 * paquete real de npm y hace una búsqueda de verdad. Necesita red y puede tardar (npx puede tener que
 * descargar el paquete la primera vez) — por eso NO corre en la suite normal, para no romper CI sin red
 * ni ralentizarla. Ejecutar a mano tras validar/actualizar una entrada del catálogo:
 *   AUTOCODE_TEST_MCP_LIVE=1 vitest run src/main/__tests__/mcp-catalog-live.test.ts
 */
const enabled = process.env.AUTOCODE_TEST_MCP_LIVE === "1";

describe.runIf(enabled)("catálogo MCP — verificación en vivo de 'busqueda-web'", () => {
  test("conecta con el MCP real y devuelve resultados de una búsqueda real", async () => {
    const entry = getCatalogEntry("busqueda-web");
    expect(entry).toBeDefined();
    expect(entry!.estado).toBe("disponible");

    const conn = await connectEntry(entry!, {});
    try {
      const buscar = conn.tools.find((t) => t.name === "busqueda_web__search");
      expect(buscar).toBeDefined();

      const resultado = await buscar!.run({ query: "AutoCode Model Context Protocol", limit: 3 });
      expect(resultado).not.toContain("(sin contenido)");
      expect(resultado.length).toBeGreaterThan(20);
    } finally {
      await conn.client.close();
    }
  }, 60_000);
});
