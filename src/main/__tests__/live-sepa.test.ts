import { describe, expect, test } from "vitest";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { AppConfig } from "@shared";
import { runBuilder } from "../agents/builder.js";
import { verifyVisual } from "../agents/verify-visual.js";

/**
 * DEMOSTRACIÓN EN VIVO end-to-end: reproduce lo que hace el executor para una app de escritorio nueva —
 * materializa el andamiaje dorado, instala deps en host, deja que el AGENTE REAL construya la SEPA
 * ENCIMA, construye el renderer y verifica visualmente que RENDERIZA. Gateada por env (modelo real):
 *   eval "$(ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/dump-config.cjs)"
 *   AUTOCODE_LIVE=1 node node_modules/vitest/vitest.mjs run src/main/__tests__/live-sepa.test.ts
 */
const enabled = process.env.AUTOCODE_LIVE === "1" && !!process.env.AUTOCODE_LITELLM_KEY;

function stripFrontMatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}

function npm(args: string[], cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", args, { cwd, env: { ...process.env, CI: "1", NO_COLOR: "1" }, stdio: "ignore", shell: true });
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve(-1); }, timeoutMs);
    child.on("close", (c) => { clearTimeout(t); resolve(c ?? -1); });
    child.on("error", () => { clearTimeout(t); resolve(-1); });
  });
}

const SPEC = [
  "Editor de ficheros SEPA pain.001 de nóminas — app de ESCRITORIO (Electron + Vue).",
  "PRIORIDAD: una primera versión que ARRANQUE y SE VEA. Mantén el render (App.vue debe montar UI siempre).",
  "Funcionalidad mínima de esta primera versión:",
  "1. Botón 'Abrir fichero' que pide un XML SEPA (vía IPC: el main usa dialog.showOpenDialog y lee el fichero).",
  "2. Parsear el pain.001 (usa una librería de XML o el DOMParser del renderer) y extraer las transferencias:",
  "   beneficiario (Cdtr/Nm), IBAN (CdtrAcct/Id/IBAN), importe (Amt/InstdAmt), concepto (RmtInf/Ustrd).",
  "3. Mostrar una TABLA con esas transferencias + un panel de RESUMEN (nº transferencias, importe total, identificador de remesa).",
  "4. Permitir editar el importe de una fila y RECALCULAR los totales de control (GrpHdr/CtrlSum, PmtInf/CtrlSum, NbOfTxs).",
  "5. Botón 'Exportar' que regenera un XML SEPA válido con los cambios (vía IPC en el main).",
  "Arquitectura: dominio en src/main (entidades Transferencia/Remesa, servicios de parseo/recálculo/exportación),",
  "IPC en el main para abrir/exportar, y las PANTALLAS en src/renderer/src (componentes .vue desde App.vue).",
  "NO recrees el andamiaje (package.json, electron.vite.config, tsconfig, main/preload base): ya está y renderiza.",
].join("\n");

describe.runIf(enabled)("DEMO EN VIVO — SEPA de escritorio sobre el andamiaje", () => {
  test("materializa + instala + el agente construye + build + renderiza", async () => {
    const repo = process.cwd();
    const ws = path.join(repo, ".tmp-sepa-live", "_app");
    await fs.rm(path.dirname(ws), { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(ws, { recursive: true });

    // 1) Materializar el andamiaje dorado (lo que hace el programa, aquí por copia directa).
    await fs.cp(path.join(repo, "templates", "electron-app"), ws, { recursive: true });
    console.log("MATERIALIZED:", (await fs.readdir(ws)).join(", "));

    // 2) Instalar deps en host (como hace ensureAppDeps sin Docker).
    const inst = await npm(["install", "--no-audit", "--no-fund", "--no-progress"], ws, 300_000);
    console.log("NPM_INSTALL_EXIT:", inst);
    expect(inst).toBe(0);

    // 3) El AGENTE REAL construye la SEPA encima del andamiaje.
    const cfg = {
      generation: {
        mode: "local", provider: "local",
        baseUrl: process.env.AUTOCODE_LITELLM_URL!, apiKey: process.env.AUTOCODE_LITELLM_KEY!,
        mainModel: process.env.AUTOCODE_CODE_MODEL!, fastModel: process.env.AUTOCODE_CODE_MODEL!,
      },
      projectsRoot: "", qdrantUrl: "http://localhost:6333",
    } as AppConfig;
    const systemPrompt = stripFrontMatter(readFileSync(path.join(repo, "prompts", "builder-system.md"), "utf-8"));

    const res = await runBuilder(
      cfg, ws,
      { projectId: "sepa-live", appType: "electron", scaffolded: true, planContext: SPEC },
      { systemPrompt },
    );
    console.log("BUILDER_RESULT:", JSON.stringify(res));
    const vues = (await listFiles(path.join(ws, "src"))).filter((f) => f.endsWith(".vue") || f.endsWith(".ts"));
    console.log("AGENT_FILES:", vues.length, vues.slice(0, 40).join(", "));

    // 4) Build del renderer (electron-vite) + verificación visual real.
    const build = await npm(["run", "build"], ws, 240_000);
    console.log("NPM_BUILD_EXIT:", build);

    const vis = await verifyVisual(ws, "electron", 25_000);
    console.log("VISUAL_VERDICT:", JSON.stringify({ ok: vis.ok, skipped: vis.skipped, findings: vis.findings, screenshot: vis.screenshot }));
    if (vis.screenshot && existsSync(vis.screenshot)) {
      const dest = path.join(repo, ".tmp-sepa-live", "screenshot.png");
      await fs.copyFile(vis.screenshot, dest).catch(() => {});
      console.log("SCREENSHOT_PATH:", dest);
    }
    // No assert estricto sobre el contenido del agente; el objetivo es OBSERVAR el resultado real.
    expect(res.cycles).toBeGreaterThan(0);
  }, 1_200_000);
});

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "out") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), r)));
    else out.push(r);
  }
  return out;
}
