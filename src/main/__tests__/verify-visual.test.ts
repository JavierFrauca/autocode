import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyVisual } from "../agents/verify-visual.js";

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
    const res = await verifyVisual(tmp, "electron", 25_000);
    expect(res.ran).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(res.screenshot).toBeTruthy();
    expect(existsSync(res.screenshot!)).toBe(true);
    expect(res.ok).toBe(true);
  }, 30_000);

  test("apps web se omiten con motivo (no es escritorio)", async () => {
    const res = await verifyVisual(tmp, "server");
    expect(res.ran).toBe(false);
    expect(res.skipped).toMatch(/web|escritorio/i);
  });
});
