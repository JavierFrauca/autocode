import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { AppType } from "@shared";
import { log } from "../log.js";
import { childEnv } from "../util/proc-env.js";
import { listProjectScreens, mockupPathFor, resolveProjectRoot } from "./mockup.js";

/**
 * Verificación VISUAL de apps de escritorio: lanza el renderer YA CONSTRUIDO de la app generada en una
 * ventana de Electron OCULTA, captura un screenshot y comprueba que RENDERIZA de verdad (no pantalla en
 * blanco, sin crash de render, DOM con contenido). Es el gate que va más allá de "compila": una app
 * puede compilar y mostrar una pantalla en blanco. Usa el arnés `scripts/visual-capture.cjs`.
 *
 * Best-effort y honesto: si no hay binario de Electron localizable (app empaquetada), falta el arnés o
 * el renderer no está construido, se OMITE con un motivo claro — nunca inventa un "ok".
 */

export interface ElementCounts {
  inputs: number;
  buttons: number;
  tableRows: number;
}

export interface ScreenCheck {
  slug: string;
  status: "checked" | "no-route" | "no-mockup" | "capture-failed";
  ok?: boolean;
  screenshot?: string;
  counts?: { mockup: ElementCounts; real: ElementCounts };
  /** Detalle en lenguaje llano de la comparación (o del motivo de no-route/no-mockup). */
  detail?: string;
}

export interface VisualResult {
  ran: boolean;
  ok: boolean;
  screenshot?: string;
  findings: Array<Record<string, unknown>>;
  skipped?: string;
  /** Solo cuando appType === "server": detalle por pantalla verificada contra su maqueta. */
  screens?: ScreenCheck[];
}

/** Cuenta campos/botones/filas de tabla en un HTML (maqueta estática o DOM serializado). Heurístico, no un parser DOM completo — basta para detectar una desviación GRUESA de la maqueta. */
export function countHtmlElements(html: string): ElementCounts {
  const count = (re: RegExp) => (html.match(re) || []).length;
  return {
    inputs: count(/<(input|select|textarea)\b/gi),
    buttons: count(/<button\b/gi),
    tableRows: count(/<tr\b/gi),
  };
}

const COUNT_TOLERANCE = 0.4; // 40%: la maqueta es un boceto, no pixel-perfect — solo cazamos desviaciones GRUESAS.

function withinTolerance(mockupN: number, realN: number): boolean {
  if (mockupN === 0) return true; // la maqueta no marcaba nada de este tipo: no hay base de comparación
  if (realN === 0) return mockupN <= 1; // tolera un elemento puramente decorativo en el boceto
  return Math.abs(mockupN - realN) / mockupN <= COUNT_TOLERANCE;
}

/** Compara los conteos de la maqueta contra los de la pantalla realmente construida, con margen de tolerancia. */
export function compareElementCounts(mockup: ElementCounts, real: ElementCounts): { withinTolerance: boolean; detail: string } {
  const checks: Array<{ label: string; ok: boolean; mockup: number; real: number }> = [
    { label: "campos", ok: withinTolerance(mockup.inputs, real.inputs), mockup: mockup.inputs, real: real.inputs },
    { label: "botones", ok: withinTolerance(mockup.buttons, real.buttons), mockup: mockup.buttons, real: real.buttons },
    { label: "filas de tabla", ok: withinTolerance(mockup.tableRows, real.tableRows), mockup: mockup.tableRows, real: real.tableRows },
  ];
  const bad = checks.filter((c) => !c.ok);
  return {
    withinTolerance: bad.length === 0,
    detail: bad.length
      ? bad.map((c) => `${c.label}: maqueta ${c.mockup} vs. construido ${c.real}`).join("; ")
      : "coincide con la maqueta dentro de tolerancia",
  };
}

export interface RouterRoute {
  name: string;
  path: string;
}

/**
 * Parseo HEURÍSTICO (no AST) de las rutas de un `router.ts` de Vue Router: empareja cada `name:` con el
 * `path:` más cercano que lo precede dentro de una ventana razonable (mismo objeto de ruta). Suficiente
 * para localizar la URL de una pantalla por su `name` (que el builder debe igualar al slug — ver
 * `builder-system.md`); no pretende sustituir un parser TypeScript real.
 */
export function parseRouterRoutes(source: string): RouterRoute[] {
  const pathRe = /\bpath\s*:\s*["'`]([^"'`]+)["'`]/g;
  const nameRe = /\bname\s*:\s*["'`]([^"'`]+)["'`]/g;
  const paths: Array<{ idx: number; value: string }> = [];
  const names: Array<{ idx: number; value: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(source))) paths.push({ idx: m.index, value: m[1] });
  while ((m = nameRe.exec(source))) names.push({ idx: m.index, value: m[1] });

  const routes: RouterRoute[] = [];
  for (const n of names) {
    let best: { idx: number; value: string } | undefined;
    for (const p of paths) {
      if (p.idx < n.idx && (!best || p.idx > best.idx)) best = p;
    }
    if (best && n.idx - best.idx < 400) routes.push({ name: n.value, path: best.value });
  }
  return routes;
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

interface CaptureOutcome {
  ran: boolean;
  ok: boolean;
  screenshot?: string;
  findings: Array<Record<string, unknown>>;
  counts?: ElementCounts;
  skipped?: string;
}

/** Lanza `visual-capture.cjs` bajo Electron contra una URL/fichero y parsea su veredicto. Compartido por
 *  la verificación de escritorio y la de web (que además pasa `cookie` para entrar ya autenticado). */
async function runCapture(
  bin: string, script: string, url: string, outDir: string, timeoutMs: number, cookie?: string, cwd?: string,
): Promise<CaptureOutcome> {
  const png = path.join(outDir, "screenshot.png");
  const verdictPath = path.join(outDir, "verdict.json");
  await fs.mkdir(outDir, { recursive: true }).catch(() => {});
  await fs.rm(verdictPath, { force: true }).catch(() => {});

  const args = [
    script,
    `--url=${url}`,
    `--out=${png}`,
    `--verdict=${verdictPath}`,
    `--timeout=${Math.max(5000, timeoutMs - 3000)}`,
  ];
  if (cookie) args.push(`--cookie=${cookie}`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(bin, args, {
      cwd,
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
      counts: verdict.counts ?? undefined,
    };
  } catch {
    log.warn("verify-visual", "la captura no dejó veredicto", { code });
    return {
      ran: true, ok: false, findings: [{ type: "no-verdict", code }],
      skipped: code === -1 ? "la captura visual no respondió a tiempo" : undefined,
    };
  }
}

async function verifyVisualElectron(ws: string, timeoutMs: number): Promise<VisualResult> {
  const root = autocodeRoot();
  const bin = electronBinary(root);
  if (!bin) return { ran: false, ok: false, findings: [], skipped: "binario de Electron no localizable (¿app empaquetada?)" };

  const script = path.join(root, "scripts", "visual-capture.cjs");
  if (!existsSync(script)) return { ran: false, ok: false, findings: [], skipped: "falta scripts/visual-capture.cjs" };

  const index = findBuiltRenderer(ws);
  if (!index) {
    return { ran: false, ok: false, findings: [], skipped: "no hay renderer construido (hace falta el build de electron-vite antes de la verificación visual)" };
  }

  const outcome = await runCapture(bin, script, index, path.join(ws, ".visual"), timeoutMs, undefined, ws);
  return { ran: outcome.ran, ok: outcome.ok, screenshot: outcome.screenshot, findings: outcome.findings, skipped: outcome.skipped };
}

// ── Verificación de apps `server`: arranca el servidor de verdad y navega pantalla a pantalla ──────────

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(url: string, timeoutMs: number, hasExited: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited()) return false;
    try { if ((await fetch(`${url}/api/health`)).ok) return true; } catch { /* aún no escucha */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export interface EphemeralServer {
  url: string;
  email: string;
  password: string;
  stop: () => void;
}

/** Arranca `dist/server.js` en un puerto libre con una BD SQLite EFÍMERA (no la del preview del usuario)
 *  y credenciales de admin sembradas, solo para esta verificación; se para siempre al terminar. */
async function startEphemeralServer(ws: string, timeoutMs: number): Promise<EphemeralServer | { error: string }> {
  if (!existsSync(path.join(ws, "dist", "server.js"))) return { error: "no hay dist/server.js (falta construir la app antes de verificarla)" };
  const port = await freePort().catch(() => 0);
  if (!port) return { error: "no se pudo reservar un puerto libre" };
  const email = "qa-visual@example.com";
  const password = randomBytes(9).toString("hex");
  const env = {
    PORT: String(port),
    DB_FILE: path.join(ws, ".qa-visual.sqlite"),
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SEED_ADMIN_EMAIL: email,
    SEED_ADMIN_PASSWORD: password,
  };
  let exitCode: number | null = null;
  const proc = spawn("node", ["dist/server.js"], { cwd: ws, env: childEnv(env), stdio: "ignore" });
  proc.on("exit", (code) => { exitCode = code ?? -1; });
  const url = `http://127.0.0.1:${port}`;
  const ok = await waitHealth(url, timeoutMs, () => exitCode !== null);
  const stop = () => { try { proc.kill(); } catch {} };
  if (!ok) { stop(); return { error: "el servidor efímero no respondió a tiempo" }; }
  return { url, email, password, stop };
}

/** Login contra el servidor arrancado; devuelve la cookie de sesión ("nombre=valor") o null si falló. */
async function defaultLogin(url: string, email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const m = setCookie.match(/^([^=;]+)=([^;]+)/);
    return m ? `${m[1]}=${m[2]}` : null;
  } catch {
    return null;
  }
}

export interface VerifyVisualServerDeps {
  startServer?: (ws: string, timeoutMs: number) => Promise<EphemeralServer | { error: string }>;
  login?: (url: string, email: string, password: string) => Promise<string | null>;
  readRouterSource?: (ws: string) => Promise<string | null>;
  listScreens?: (projectId: string) => Promise<Array<{ slug: string; rel: string; kind: string; hasMockup: boolean }>>;
  readMockupHtml?: (rootPath: string, rel: string) => Promise<string | null>;
  resolveRootPath?: (projectId: string) => Promise<string>;
  captureScreen?: (url: string, cookie: string | null, outDir: string, timeoutMs: number) => Promise<CaptureOutcome>;
}

async function defaultReadRouterSource(ws: string): Promise<string | null> {
  for (const rel of ["web/src/router.ts", "src/renderer/src/router.ts"]) {
    try { return await fs.readFile(path.join(ws, rel), "utf-8"); } catch { /* prueba el siguiente */ }
  }
  return null;
}

async function verifyVisualServer(
  ws: string, projectId: string, timeoutMs: number, deps: VerifyVisualServerDeps = {},
): Promise<VisualResult> {
  const root = autocodeRoot();
  const bin = electronBinary(root);
  const script = path.join(root, "scripts", "visual-capture.cjs");
  if (!bin) return { ran: false, ok: false, findings: [], skipped: "binario de Electron no localizable (¿app empaquetada?)" };
  if (!existsSync(script)) return { ran: false, ok: false, findings: [], skipped: "falta scripts/visual-capture.cjs" };

  const start = deps.startServer ?? startEphemeralServer;
  const server = await start(ws, timeoutMs);
  if ("error" in server) return { ran: false, ok: false, findings: [], skipped: server.error };

  try {
    const login = deps.login ?? defaultLogin;
    const cookie = await login(server.url, server.email, server.password);

    const readRouter = deps.readRouterSource ?? defaultReadRouterSource;
    const routerSource = await readRouter(ws);
    const routes = routerSource ? parseRouterRoutes(routerSource) : [];

    const resolveRoot = deps.resolveRootPath ?? resolveProjectRoot;
    const rootPath = await resolveRoot(projectId).catch(() => null);
    const listScreens = deps.listScreens ?? (async (pid: string) => {
      if (!rootPath) return [];
      return listProjectScreens(rootPath);
    });
    const screensInfo = await listScreens(projectId);
    const readMockup = deps.readMockupHtml ?? (async (rp: string, rel: string) => {
      try { return await fs.readFile(path.resolve(rp, mockupPathFor(rel)), "utf-8"); } catch { return null; }
    });
    const capture = deps.captureScreen ?? ((url, ck, outDir, tms) => runCapture(bin, script, url, outDir, tms, ck ?? undefined));

    const outDirBase = path.join(ws, ".visual");
    const screens: ScreenCheck[] = [];
    const pages = screensInfo.filter((s) => s.kind === "pagina");
    for (const screen of pages) {
      const route = routes.find((r) => r.name === screen.slug);
      if (!route) { screens.push({ slug: screen.slug, status: "no-route", detail: "sin ruta registrada con name == slug en router.ts" }); continue; }
      if (!screen.hasMockup) { screens.push({ slug: screen.slug, status: "no-mockup", detail: "esta pantalla no tiene maqueta que comparar" }); continue; }

      const mockupHtml = rootPath ? await readMockup(rootPath, screen.rel) : null;
      let outcome: CaptureOutcome;
      try {
        outcome = await capture(`${server.url}${route.path}`, cookie, path.join(outDirBase, screen.slug), Math.min(timeoutMs, 20_000));
      } catch (e: any) {
        screens.push({ slug: screen.slug, status: "capture-failed", detail: `error capturando la pantalla: ${e?.message ?? e}` });
        continue;
      }
      if (!outcome.ran || !outcome.counts || !mockupHtml) {
        screens.push({ slug: screen.slug, status: "capture-failed", ok: outcome.ok, screenshot: outcome.screenshot, detail: outcome.skipped ?? "no se pudo capturar/contar la pantalla" });
        continue;
      }
      const cmp = compareElementCounts(countHtmlElements(mockupHtml), outcome.counts);
      screens.push({
        slug: screen.slug, status: "checked", ok: outcome.ok && cmp.withinTolerance,
        screenshot: outcome.screenshot, counts: { mockup: countHtmlElements(mockupHtml), real: outcome.counts }, detail: cmp.detail,
      });
    }

    const checked = screens.filter((s) => s.status === "checked");
    const ok = checked.length > 0 && checked.every((s) => s.ok);
    return {
      ran: true,
      ok,
      screenshot: checked[0]?.screenshot,
      findings: [],
      screens,
      skipped: screens.length === 0 ? "no hay pantallas con ruta+maqueta que verificar" : undefined,
    };
  } finally {
    server.stop();
  }
}

export async function verifyVisual(
  ws: string, appType: AppType, projectId: string, timeoutMs = 30_000, deps: VerifyVisualServerDeps = {},
): Promise<VisualResult> {
  if (appType === "server") return verifyVisualServer(ws, projectId, timeoutMs, deps);
  if (appType !== "electron") {
    return { ran: false, ok: false, findings: [], skipped: "verificación visual solo aplica a escritorio y web; MCP no tiene UI" };
  }
  return verifyVisualElectron(ws, timeoutMs);
}
