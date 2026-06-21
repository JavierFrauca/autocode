import { spawn } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { AppType } from "@shared";
import { log } from "../log.js";

/**
 * Verificación VISUAL de apps de escritorio: lanza el renderer YA CONSTRUIDO de la app generada en una
 * ventana de Electron OCULTA, captura un screenshot y comprueba que RENDERIZA de verdad (no pantalla en
 * blanco, sin crash de render, DOM con contenido). Es el gate que va más allá de "compila": una app
 * puede compilar y mostrar una pantalla en blanco. Usa el arnés `scripts/visual-capture.cjs`.
 *
 * Best-effort y honesto: si no hay binario de Electron localizable (app empaquetada), falta el arnés o
 * el renderer no está construido, se OMITE con un motivo claro — nunca inventa un "ok".
 */

export interface VisualResult {
  ran: boolean;
  ok: boolean;
  screenshot?: string;
  findings: Array<Record<string, unknown>>;
  skipped?: string;
}

/** Raíz de AutoCode (donde vive node_modules/electron). Difiere entre compilado y test sobre fuente. */
function autocodeRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "node_modules", "electron", "path.txt"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, "../..");
}

/**
 * Binario de Electron (cross-platform). Prueba varias ubicaciones porque el `path.txt` del paquete no
 * siempre coincide con el layout real (en esta instalación dice "electron.exe" pero vive en `dist/`).
 */
function electronBinary(root: string): string | null {
  const elDir = path.join(root, "node_modules", "electron");
  const candidates: string[] = [];
  try {
    const rel = readFileSync(path.join(elDir, "path.txt"), "utf-8").trim();
    if (rel) { candidates.push(path.join(elDir, rel), path.join(elDir, "dist", rel)); }
  } catch {}
  // Defaults por plataforma como red de seguridad.
  if (process.platform === "win32") candidates.push(path.join(elDir, "dist", "electron.exe"));
  else if (process.platform === "darwin") candidates.push(path.join(elDir, "dist", "Electron.app", "Contents", "MacOS", "Electron"));
  else candidates.push(path.join(elDir, "dist", "electron"));
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Localiza el index.html del renderer construido (electron-vite emite a out/renderer por defecto). */
function findBuiltRenderer(ws: string): string | null {
  const candidates = ["out/renderer/index.html", "dist/renderer/index.html", "build/renderer/index.html", "dist/index.html"];
  for (const c of candidates) {
    const p = path.join(ws, c);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function verifyVisual(ws: string, appType: AppType, timeoutMs = 30_000): Promise<VisualResult> {
  if (appType !== "electron") {
    return { ran: false, ok: false, findings: [], skipped: "verificación visual solo aplica a escritorio (electron); web → probe HTTP; MCP no tiene UI" };
  }
  const root = autocodeRoot();
  const bin = electronBinary(root);
  if (!bin) return { ran: false, ok: false, findings: [], skipped: "binario de Electron no localizable (¿app empaquetada?)" };

  const script = path.join(root, "scripts", "visual-capture.cjs");
  if (!existsSync(script)) return { ran: false, ok: false, findings: [], skipped: "falta scripts/visual-capture.cjs" };

  const index = findBuiltRenderer(ws);
  if (!index) {
    return { ran: false, ok: false, findings: [], skipped: "no hay renderer construido (hace falta el build de electron-vite antes de la verificación visual)" };
  }

  const outDir = path.join(ws, ".visual");
  const png = path.join(outDir, "screenshot.png");
  const verdictPath = path.join(outDir, "verdict.json");
  await fs.mkdir(outDir, { recursive: true }).catch(() => {});
  await fs.rm(verdictPath, { force: true }).catch(() => {});

  const args = [
    script,
    `--url=${index}`,
    `--out=${png}`,
    `--verdict=${verdictPath}`,
    `--timeout=${Math.max(5000, timeoutMs - 3000)}`,
  ];

  const code = await new Promise<number>((resolve) => {
    const child = spawn(bin, args, {
      cwd: ws,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
      stdio: "ignore",
    });
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(-1); }, timeoutMs);
    child.on("close", (c) => { clearTimeout(timer); resolve(c ?? -1); });
    child.on("error", () => { clearTimeout(timer); resolve(-1); });
  });

  try {
    const verdict = JSON.parse(await fs.readFile(verdictPath, "utf-8"));
    return {
      ran: true,
      ok: !!verdict.ok,
      screenshot: verdict.out ?? (existsSync(png) ? png : undefined),
      findings: Array.isArray(verdict.findings) ? verdict.findings : [],
    };
  } catch {
    log.warn("verify-visual", "la captura no dejó veredicto", { code });
    return {
      ran: true, ok: false, findings: [{ type: "no-verdict", code }],
      skipped: code === -1 ? "la captura visual no respondió a tiempo" : undefined,
    };
  }
}
