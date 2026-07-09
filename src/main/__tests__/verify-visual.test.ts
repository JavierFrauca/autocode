import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareElementCounts, countHtmlElements, parseRouterRoutes, verifyVisual,
} from "../agents/verify-visual.js";

/**
 * Verificación VISUAL end-to-end: monta un renderer de prueba y comprueba que `verifyVisual` lanza
 * Electron oculto, captura el screenshot y emite veredicto. Lanza una ventana real de Electron, así que
 * va GATEADO por env (necesita binario de Electron + display) para no romper la suite normal:
 *   AUTOCODE_TEST_VISUAL=1 vitest run src/main/__tests__/verify-visual.test.ts
 */
const enabled = process.env.AUTOCODE_TEST_VISUAL === "1";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head>
<body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;padding:40px">
<h1 style="color:#38bdf8">App generada</h1><p>Renderiza de verdad.</p></body></html>`;

describe.runIf(enabled)("verifyVisual (escritorio, end-to-end)", () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "autocode-visual-"));
    const dir = path.join(tmp, "out", "renderer");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), PAGE, "utf-8");
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  test("renderiza el renderer construido y deja screenshot + veredicto ok", async () => {
    const res = await verifyVisual(tmp, "electron", "proyecto-test", 25_000);
    expect(res.ran).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(res.screenshot).toBeTruthy();
    expect(existsSync(res.screenshot!)).toBe(true);
    expect(res.ok).toBe(true);
  }, 30_000);

  test("apps server sin dist/server.js se omiten con motivo (falta construir)", async () => {
    const res = await verifyVisual(tmp, "server", "proyecto-test");
    expect(res.ran).toBe(false);
    expect(res.skipped).toBeTruthy();
  });

  test("MCP se omite (sin UI)", async () => {
    const res = await verifyVisual(tmp, "mcp", "proyecto-test");
    expect(res.ran).toBe(false);
    expect(res.skipped).toMatch(/mcp/i);
  });
});

describe("countHtmlElements / compareElementCounts (comparación estructural maqueta vs. real)", () => {
  test("cuenta campos, botones y filas de tabla", () => {
    const html = "<input><select></select><textarea></textarea><button>ok</button><table><tr></tr><tr></tr></table>";
    expect(countHtmlElements(html)).toEqual({ inputs: 3, buttons: 1, tableRows: 2 });
  });

  test("dentro de tolerancia (±40%) → sin desviación", () => {
    const mockup = { inputs: 5, buttons: 2, tableRows: 0 };
    const real = { inputs: 4, buttons: 2, tableRows: 0 };
    expect(compareElementCounts(mockup, real).withinTolerance).toBe(true);
  });

  test("muchos menos campos que la maqueta → desviación detectada", () => {
    const mockup = { inputs: 8, buttons: 2, tableRows: 0 };
    const real = { inputs: 2, buttons: 2, tableRows: 0 };
    const cmp = compareElementCounts(mockup, real);
    expect(cmp.withinTolerance).toBe(false);
    expect(cmp.detail).toMatch(/campos: maqueta 8 vs\. construido 2/);
  });

  test("maqueta sin ese tipo de elemento no exige nada (nada que comparar)", () => {
    expect(compareElementCounts({ inputs: 0, buttons: 0, tableRows: 0 }, { inputs: 5, buttons: 3, tableRows: 1 }).withinTolerance).toBe(true);
  });
});

describe("verifyVisual (server, con dependencias falseadas — sin Electron ni servidor real)", () => {
  const ROUTER_SRC = `
    export const routes = [
      { path: "/clientes", name: "cliente-lista", component: () => import("./views/ClienteListaView.vue") },
    ];
  `;
  const MOCKUP_HTML = "<input><input><button>Guardar</button>";

  function baseDeps(overrides: Partial<Parameters<typeof verifyVisual>[4]> = {}) {
    return {
      startServer: async () => ({ url: "http://127.0.0.1:9", email: "a@b.com", password: "x", stop: () => {} }),
      login: async () => "sesion=abc",
      readRouterSource: async () => ROUTER_SRC,
      resolveRootPath: async () => "/tmp/proyecto",
      listScreens: async () => [
        { slug: "cliente-lista", rel: "pantallas/cliente-lista.md", kind: "pagina", hasMockup: true },
        { slug: "sin-ruta", rel: "pantallas/sin-ruta.md", kind: "pagina", hasMockup: true },
      ],
      readMockupHtml: async () => MOCKUP_HTML,
      ...overrides,
    };
  }

  test("pantalla con ruta+maqueta: cuenta OK cuando el real coincide con la maqueta", async () => {
    const res = await verifyVisual("/tmp/ws", "server", "proj1", 10_000, baseDeps({
      captureScreen: async () => ({ ran: true, ok: true, findings: [], counts: { inputs: 2, buttons: 1, tableRows: 0 } }),
    }));
    expect(res.ran).toBe(true);
    expect(res.ok).toBe(true);
    const cliente = res.screens?.find((s) => s.slug === "cliente-lista");
    expect(cliente?.status).toBe("checked");
    expect(cliente?.ok).toBe(true);
  });

  test("pantalla sin ruta registrada (name != slug) → no-route, no bloquea el resto", async () => {
    const res = await verifyVisual("/tmp/ws", "server", "proj1", 10_000, baseDeps({
      captureScreen: async () => ({ ran: true, ok: true, findings: [], counts: { inputs: 2, buttons: 1, tableRows: 0 } }),
    }));
    const sinRuta = res.screens?.find((s) => s.slug === "sin-ruta");
    expect(sinRuta?.status).toBe("no-route");
  });

  test("pantalla real con muchos menos campos que la maqueta → ok=false y detalle de la desviación", async () => {
    const res = await verifyVisual("/tmp/ws", "server", "proj1", 10_000, baseDeps({
      captureScreen: async () => ({ ran: true, ok: true, findings: [], counts: { inputs: 0, buttons: 0, tableRows: 0 } }),
    }));
    const cliente = res.screens?.find((s) => s.slug === "cliente-lista");
    expect(cliente?.ok).toBe(false);
    expect(cliente?.detail).toMatch(/campos/);
    expect(res.ok).toBe(false);
  });

  test("el servidor efímero se para siempre, incluso si algo falla a mitad", async () => {
    let stopped = false;
    await verifyVisual("/tmp/ws", "server", "proj1", 10_000, baseDeps({
      startServer: async () => ({ url: "http://127.0.0.1:9", email: "a@b.com", password: "x", stop: () => { stopped = true; } }),
      captureScreen: async () => { throw new Error("boom"); },
    })).catch(() => {});
    expect(stopped).toBe(true);
  });
});

describe("parseRouterRoutes (emparejado heurístico name↔path)", () => {
  test("empareja name y path del mismo objeto de ruta", () => {
    const src = `
      const routes = [
        { path: "/clientes", name: "cliente-lista", component: ClienteListaView, meta: { menu: { icono: "x" } } },
        { path: "/clientes/:id", name: "cliente-ficha", component: ClienteFichaView },
      ];
    `;
    const routes = parseRouterRoutes(src);
    expect(routes).toContainEqual({ name: "cliente-lista", path: "/clientes" });
    expect(routes).toContainEqual({ name: "cliente-ficha", path: "/clientes/:id" });
  });

  test("sin rutas en el fichero → array vacío", () => {
    expect(parseRouterRoutes("export const x = 1;")).toEqual([]);
  });
});
