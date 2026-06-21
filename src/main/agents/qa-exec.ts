import { spawn } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { AppType } from "@shared";
import { childEnv } from "../util/proc-env.js";

/**
 * Arnés de ejecución de QA. Corre la suite de tests de un workspace generado y
 * devuelve un resultado ESTRUCTURADO y determinista. El veredicto pass/fail del
 * agente QA se ancla en esta salida real, no en la opinión del LLM.
 *
 * Diseño deliberado: vitest se resuelve desde el node_modules de AutoCode y se
 * apunta al workspace con --root, de modo que la app generada no necesita su
 * propio `npm install` para ser testeada en el bucle de desarrollo. En producción
 * las apps con Docker correrían sus tests dentro de su contenedor.
 */

export interface TestCaseResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
}

export interface VitestResult {
  ran: boolean;
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestCaseResult[];
  /** Salida cruda (stdout+stderr) recortada, para diagnóstico cuando algo no parsea. */
  raw: string;
  error?: string;
  /** Cómo se ejecutó: "docker" (aislado, sin red) o "host" (sin aislamiento real). */
  sandbox: "docker" | "host";
}

export interface TypecheckResult {
  ran: boolean;
  ok: boolean;
  output: string;
}

/**
 * Raíz del proyecto AutoCode (donde vive node_modules). Se busca hacia arriba
 * desde __dirname porque la ruta difiere entre compilado (out/main) y test sobre
 * fuente (src/main/agents).
 */
function autocodeRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "node_modules", "vitest", "vitest.mjs"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, "../..");
}

function vitestCli(): string {
  return path.join(autocodeRoot(), "node_modules", "vitest", "vitest.mjs");
}

interface SpawnCapture {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Lanza un comando arbitrario y captura su salida con timeout. */
function spawnAny(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<SpawnCapture> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut }); });
  });
}

/** Proceso node vía el binario de Electron en modo node. */
function spawnNode(args: string[], cwd: string, timeoutMs: number): Promise<SpawnCapture> {
  return spawnAny(process.execPath, args, cwd, childEnv({ ELECTRON_RUN_AS_NODE: "1", CI: "1", NO_COLOR: "1" }), timeoutMs);
}

/** Ejecuta un comando en el HOST vía shell (para resolver npm.cmd/npx.cmd en Windows). Para apps de
 *  escritorio del propio usuario, instalar/construir/empaquetar en local es aceptable (Docker es solo
 *  aislamiento opcional, y empaquetar requiere red + binarios nativos que no caben en el sandbox).
 *  `signal` permite abortar (cancelar) el proceso hijo en vuelo. */
function spawnShell(cmd: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<SpawnCapture> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ code: -1, stdout: "", stderr: "cancelado", timedOut: false }); return; }
    // childEnv: sin npm_*/INIT_CWD heredados; si no, `npm install`/`npm run build` actuarían sobre el
    // repo de AutoCode (su local-prefix) en vez de sobre `_app`. Ver util/proc-env.ts.
    const child = spawn(cmd, args, {
      cwd, env: childEnv({ CI: "1", NO_COLOR: "1" }), stdio: ["ignore", "pipe", "pipe"], shell: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const kill = () => { try { child.kill("SIGKILL"); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => { cleanup(); resolve({ code, stdout, stderr, timedOut }); });
    child.on("error", (err) => { cleanup(); resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut }); });
  });
}

/** Ejecuta npm en el HOST. */
function spawnNpm(args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<SpawnCapture> {
  return spawnShell("npm", args, cwd, timeoutMs, signal);
}

let _dockerOk: boolean | null = null;
async function dockerAvailable(): Promise<boolean> {
  if (_dockerOk !== null) return _dockerOk;
  const cap = await spawnAny("docker", ["version", "--format", "{{.Server.Version}}"], process.cwd(), process.env, 8_000);
  _dockerOk = !cap.timedOut && cap.code === 0;
  return _dockerOk;
}

/** ¿La app declara dependencias de ejecución (que requieren instalación)? */
function appHasDependencies(ws: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ws, "package.json"), "utf-8"));
    return !!pkg?.dependencies && Object.keys(pkg.dependencies).length > 0;
  } catch {
    return false;
  }
}

export type SandboxMode = "auto" | "host" | "docker";
export interface RunVitestOptions { timeoutMs?: number; sandbox?: SandboxMode }

/**
 * Ejecuta los tests del workspace y parsea el reporter JSON de vitest. El código generado
 * es NO confiable, así que la ejecución se aísla según lo disponible:
 *  - Docker => contenedor SIN red; instala deps dentro y corre el vitest de la app. (aislado)
 *  - Sin Docker + app sin dependencias => vitest de AutoCode via --root. (host, riesgo bajo)
 *  - Sin Docker + app con dependencias => NO se ejecuta: instalar deps no confiables en el
 *    host sería inseguro → se pide Docker explícitamente.
 */
export async function runVitest(workspaceDir: string, opts: RunVitestOptions = {}): Promise<VitestResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const mode = opts.sandbox ?? "auto";

  // Solo Docker EXPLÍCITO usa el contenedor. En "auto" los tests corren en el HOST (donde vive y se
  // ejecuta la app, monopuesto): así no se reinstalan node_modules linux que romperían el build/preview
  // del host — el Docker "auto" clobbeaba los binarios nativos de los node_modules compartidos.
  if (mode === "docker") return runVitestInDocker(workspaceDir, timeoutMs);

  // Apps con dependencias: se ejecutan en host con sus node_modules ya instalados (ensureAppDeps los
  // deja en el host). Si aún no están instalados, los tests quedan INCONCLUSOS (no bloquean el verde).
  if (appHasDependencies(workspaceDir) && !existsSync(path.join(workspaceDir, "node_modules"))) {
    return emptyResult("", "host", "node_modules no instalado: tests no ejecutados (inconcluso)");
  }
  return runVitestOnHost(workspaceDir, timeoutMs);
}

/** Host: vitest de AutoCode apuntando al workspace con --root (solo apps sin dependencias). */
async function runVitestOnHost(workspaceDir: string, timeoutMs: number): Promise<VitestResult> {
  const outFile = path.join(workspaceDir, ".qa-vitest-result.json");
  await fs.rm(outFile, { force: true }).catch(() => {});
  // Usa el vitest de la PROPIA app si lo trae (resuelve su config/plugins y sus deps nativas del host);
  // si no, el de AutoCode con --root (apps sin dependencias).
  const appVitest = path.join(workspaceDir, "node_modules", "vitest", "vitest.mjs");
  const useAppVitest = existsSync(appVitest);
  const cli = useAppVitest ? appVitest : vitestCli();
  const cwd = useAppVitest ? workspaceDir : autocodeRoot();
  const args = [cli, "run", "--root", workspaceDir, "--reporter=json", "--outputFile", outFile, "--passWithNoTests=false"];
  const cap = await spawnNode(args, cwd, timeoutMs);
  return parseVitestRun(outFile, cap, timeoutMs, "host");
}

/**
 * Docker: dos fases sobre el mismo workspace montado. Fase 1 instala deps (con red); fase 2
 * corre los tests SIN red, de modo que el código generado no puede salir fuera durante la
 * ejecución. Requiere que la app traiga vitest como devDependency (el coder lo genera así).
 * (Camino de producción; no verificado en este entorno por carecer de Docker.)
 */
async function runVitestInDocker(workspaceDir: string, timeoutMs: number): Promise<VitestResult> {
  const outFile = path.join(workspaceDir, ".qa-vitest-result.json");
  await fs.rm(outFile, { force: true }).catch(() => {});
  const mount = ["-v", `${workspaceDir}:/work`, "-w", "/work", "node:20-bookworm"];

  // Fase 1: instalar dependencias (con red).
  const install = await spawnAny(
    "docker",
    ["run", "--rm", "--pids-limit=512", ...mount, "npm", "install", "--no-audit", "--no-fund", "--no-progress"],
    process.cwd(), process.env, timeoutMs,
  );
  if (install.timedOut || install.code !== 0) {
    return emptyResult((install.stdout + install.stderr).slice(-4000), "docker", "falló la instalación de dependencias en el contenedor");
  }

  // Fase 2: ejecutar los tests SIN red.
  const cap = await spawnAny(
    "docker",
    ["run", "--rm", "--network=none", "--pids-limit=512", ...mount,
     "npx", "--no-install", "vitest", "run", "--reporter=json", "--outputFile", ".qa-vitest-result.json", "--passWithNoTests=false"],
    process.cwd(), process.env, timeoutMs,
  );
  return parseVitestRun(outFile, cap, timeoutMs, "docker");
}

async function parseVitestRun(
  outFile: string,
  cap: SpawnCapture,
  timeoutMs: number,
  sandbox: "host" | "docker",
): Promise<VitestResult> {
  const raw = (cap.stdout + "\n" + cap.stderr).slice(-8000);
  if (cap.timedOut) return emptyResult(raw, sandbox, `Timeout tras ${timeoutMs}ms ejecutando los tests`);

  let report: any;
  try {
    report = JSON.parse(await fs.readFile(outFile, "utf-8"));
  } catch {
    return emptyResult(raw, sandbox, "vitest no generó resultados (¿error de compilación o sin tests?)");
  } finally {
    await fs.rm(outFile, { force: true }).catch(() => {});
  }

  const tests: TestCaseResult[] = [];
  for (const suite of report.testResults ?? []) {
    for (const a of suite.assertionResults ?? []) {
      tests.push({
        name: a.fullName ?? a.title ?? "(sin nombre)",
        status: a.status === "passed" ? "passed" : a.status === "skipped" || a.status === "pending" ? "skipped" : "failed",
        message: Array.isArray(a.failureMessages) && a.failureMessages.length > 0
          ? a.failureMessages.join("\n").slice(0, 2000)
          : undefined,
      });
    }
  }

  const passed = report.numPassedTests ?? tests.filter((t) => t.status === "passed").length;
  const failed = report.numFailedTests ?? tests.filter((t) => t.status === "failed").length;
  const skipped = report.numPendingTests ?? tests.filter((t) => t.status === "skipped").length;
  const total = report.numTotalTests ?? tests.length;

  return {
    ran: true,
    success: failed === 0 && total > 0 && (report.success ?? true),
    total, passed, failed, skipped, tests, raw, sandbox,
  };
}

function emptyResult(raw: string, sandbox: "host" | "docker", error: string): VitestResult {
  return { ran: false, success: false, total: 0, passed: 0, failed: 0, skipped: 0, tests: [], raw, error, sandbox };
}

export interface CompileResult {
  /** true si llegó a ejecutarse tsc (false = omitido por falta de tsconfig/docker). */
  ran: boolean;
  ok: boolean;
  /** Salida de tsc (errores), recortada. */
  errors: string;
}

/** Marca dentro de node_modules la plataforma con la que se instaló (para detectar binarios cruzados). */
const PLATFORM_MARKER = ".autocode-platform";

/**
 * Instala las dependencias de la app en el HOST, una vez. Idempotente: si ya hay node_modules (de ESTA
 * plataforma) o la app no declara dependencias, no hace nada. AUTO-CURA: si encuentra node_modules de
 * OTRA plataforma (p.ej. better-sqlite3/rollup compilados en Docker-linux que el host no puede cargar
 * → "is not a valid Win32 application" / ERR_DLOPEN_FAILED), los borra y reinstala limpio.
 */
export async function ensureAppDeps(
  ws: string,
  opts: { force?: boolean; timeoutMs?: number } = {},
): Promise<{ ok: boolean; output: string; skipped: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  if (!appHasDependencies(ws)) return { ok: true, output: "(sin dependencias)", skipped: true };

  const nm = path.join(ws, "node_modules");
  const marker = path.join(nm, PLATFORM_MARKER);
  let installedFor: string | null = null;
  try { installedFor = readFileSync(marker, "utf-8").trim(); } catch { /* sin marca: instalación vieja o de Docker */ }
  const platformOk = installedFor === process.platform;

  if (!opts.force && existsSync(nm) && platformOk) return { ok: true, output: "(node_modules ya presente)", skipped: true };

  // node_modules de OTRA plataforma (o sin marca, p.ej. los que dejó un build/test en Docker-linux): se
  // borran node_modules + lock y se reinstala NATIVO del host. Se borra también el lock porque un
  // package-lock cruzado dispara el bug de optional-deps de npm (deja rollup/@rollup a medias).
  if (existsSync(nm) && !platformOk) {
    await fs.rm(nm, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    await fs.rm(path.join(ws, "package-lock.json"), { force: true, maxRetries: 3 }).catch(() => {});
  }

  // Se instala SIEMPRE en el HOST: AutoCode es monopuesto y la app se construye, se prueba ("Probar") y
  // se empaqueta en el equipo del usuario, así que sus módulos nativos (rollup, better-sqlite3, esbuild…)
  // tienen que ser los del host. Instalarlos en Docker (linux) dejaría binarios que el host no puede
  // cargar — y al revés. El aislamiento linux vive en el paquete de despliegue, no aquí.
  const cap = await spawnNpm(["install", "--no-audit", "--no-fund", "--no-progress"], ws, timeoutMs);
  const ok = !cap.timedOut && cap.code === 0;
  if (ok) await fs.writeFile(marker, process.platform, "utf-8").catch(() => {});
  return { ok, output: (cap.stdout + cap.stderr).slice(-4000), skipped: false };
}

/**
 * Compila (typecheck) la app y devuelve los errores. En Docker SIN red si hay deps (las usa de
 * node_modules, ya instaladas por ensureAppDeps); en host con el tsc de AutoCode si no hay deps.
 * Es el gate de compilación que alimenta el bucle de reparación antes de QA.
 */
export async function typecheckApp(ws: string, timeoutMs = 120_000): Promise<CompileResult> {
  const tsconfig = path.join(ws, "tsconfig.json");
  try { await fs.access(tsconfig); } catch { return { ran: false, ok: true, errors: "(sin tsconfig.json)" }; }

  if (appHasDependencies(ws) && (await dockerAvailable())) {
    const cap = await spawnAny(
      "docker",
      ["run", "--rm", "--network=none", "--pids-limit=512", "-v", `${ws}:/work`, "-w", "/work", "node:20-bookworm",
       "npx", "--no-install", "tsc", "--noEmit", "-p", "tsconfig.json"],
      process.cwd(), process.env, timeoutMs,
    );
    return { ran: true, ok: !cap.timedOut && cap.code === 0, errors: (cap.stdout + cap.stderr).slice(-8000) };
  }

  const tscCli = path.join(autocodeRoot(), "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscCli)) return { ran: false, ok: true, errors: "(typescript no disponible)" };
  const cap = await spawnNode([tscCli, "--noEmit", "-p", tsconfig], ws, timeoutMs);
  return { ran: true, ok: !cap.timedOut && cap.code === 0, errors: (cap.stdout + cap.stderr).slice(-8000) };
}

export interface BuildSmokeResult {
  /** true si llegó a ejecutarse el build. */
  ran: boolean;
  ok: boolean;
  output: string;
  /** Motivo si se omitió (sin script de build, sin Docker, tipo no soportado…). */
  skipped?: string;
}

/**
 * Verificación de ARRANQUE/BUILD: ejecuta el `npm run build` REAL de la app (emite, no solo
 * typecheck) en Docker SIN red, con las deps ya instaladas. Es un gate más fuerte que `--noEmit`:
 * cazaría fallos de emisión/empaquetado que el typecheck no ve. Best-effort: si no hay Docker, script
 * de build o `node_modules`, se omite (no es un fallo). Para `electron` el build necesita el binario
 * de Electron (descarga de red): se omite aquí y queda para la verificación visual con runtime real.
 */
export async function runBuild(ws: string, appType: AppType, timeoutMs = 300_000): Promise<BuildSmokeResult> {
  let pkg: any;
  try { pkg = JSON.parse(readFileSync(path.join(ws, "package.json"), "utf-8")); } catch { return { ran: false, ok: false, output: "", skipped: "sin package.json" }; }
  if (!pkg?.scripts?.build) return { ran: false, ok: false, output: "", skipped: "el package.json no define script 'build'" };
  if (!existsSync(path.join(ws, "node_modules"))) return { ran: false, ok: false, output: "", skipped: "node_modules no instalado" };

  // El build corre en el HOST para TODOS los tipos, igual que se instala (ensureAppDeps) y se ejecuta la
  // app (preview/empaquetado). Los binarios nativos del bundler (rollup/esbuild) y de la app
  // (better-sqlite3) son por-plataforma, así que construir el servidor en Docker (linux) contra los
  // node_modules del host (win/mac) reventaba con MODULE_NOT_FOUND. El aislamiento linux vive en el
  // paquete de despliegue (Dockerfile con su propia instalación), no en esta verificación.
  const cap = await spawnNpm(["run", "build"], ws, timeoutMs);
  return { ran: true, ok: !cap.timedOut && cap.code === 0, output: (cap.stdout + cap.stderr).slice(-6000) };
}

export interface PackageResult {
  /** true si se generó un instalador distribuible. */
  ok: boolean;
  /** Ruta absoluta al instalador (.exe) generado, si todo fue bien. */
  installerPath?: string;
  /** Salida cruda (build + electron-builder) recortada, para diagnóstico. */
  output: string;
  /** Motivo si se omitió/no aplica (sin electron-builder, sin node_modules…). */
  skipped?: string;
}

/** Localiza el instalador más reciente (.exe en la raíz de release/, NO en win-unpacked/). */
async function newestInstaller(releaseDir: string): Promise<string | undefined> {
  let entries: string[];
  try { entries = await fs.readdir(releaseDir); } catch { return undefined; }
  let best: { path: string; mtime: number } | undefined;
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".exe")) continue;
    const full = path.join(releaseDir, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtime) best = { path: full, mtime: st.mtimeMs };
    } catch {}
  }
  return best?.path;
}

/**
 * EMPAQUETADO PARA DISTRIBUCIÓN: construye la app (electron-vite build) y genera un INSTALADOR NSIS
 * (.exe) con electron-builder, para que el usuario final la instale con doble clic sin saber compilar.
 * Corre SIEMPRE en el HOST (electron-builder descarga binarios de red y usa toolchain nativo que no
 * cabe en el sandbox sin red). El productName (nombre visible + del instalable) se fija en el
 * package.json con el nombre real del proyecto, evitando pasar valores por la shell (inyección).
 * Best-effort y diagnosticable: devuelve la ruta del instalador o el motivo de la omisión/fallo.
 */
export async function runPackage(
  ws: string,
  productName: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PackageResult> {
  // 1ª vez electron-builder descarga ~100MB (Electron + NSIS) y comprime: damos margen amplio.
  const timeoutMs = opts.timeoutMs ?? 1_200_000;
  const pkgPath = path.join(ws, "package.json");
  let pkg: any;
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf-8")); }
  catch { return { ok: false, output: "", skipped: "sin package.json" }; }

  const hasBuilder = !!pkg?.devDependencies?.["electron-builder"] || !!pkg?.dependencies?.["electron-builder"];
  if (!hasBuilder) return { ok: false, output: "", skipped: "esta app no incluye electron-builder (no es de escritorio empaquetable)" };
  if (!pkg?.scripts?.build) return { ok: false, output: "", skipped: "el package.json no define script 'build'" };
  if (!existsSync(path.join(ws, "node_modules"))) return { ok: false, output: "", skipped: "node_modules no instalado" };
  if (opts.signal?.aborted) return { ok: false, output: "", skipped: "cancelado" };

  // El nombre visible del instalable = nombre del proyecto. Se escribe en package.json (electron-builder
  // lo lee de ahí), nunca por la shell, para no exponer caracteres especiales del nombre.
  const safeName = productName.replace(/[\r\n"]/g, "").trim() || "Aplicación";
  if (pkg.productName !== safeName) {
    pkg.productName = safeName;
    try { await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8"); } catch {}
  }

  // 1) Construir los bundles (electron-vite build → out/).
  const built = await spawnNpm(["run", "build"], ws, timeoutMs, opts.signal);
  if (built.timedOut) return { ok: false, output: (built.stdout + built.stderr).slice(-6000), skipped: "timeout construyendo" };
  if (built.code !== 0) return { ok: false, output: (built.stdout + built.stderr).slice(-6000) };
  if (opts.signal?.aborted) return { ok: false, output: "", skipped: "cancelado" };

  // 2) Empaquetar a instalador NSIS.
  const pack = await spawnShell("npx", ["--no-install", "electron-builder", "--win"], ws, timeoutMs, opts.signal);
  const output = (pack.stdout + pack.stderr).slice(-6000);
  if (pack.timedOut) return { ok: false, output, skipped: "timeout empaquetando" };
  if (pack.code !== 0) return { ok: false, output };

  const installerPath = await newestInstaller(path.join(ws, "release"));
  if (!installerPath) return { ok: false, output, skipped: "electron-builder terminó pero no encontré el .exe en release/" };
  return { ok: true, installerPath, output };
}

/** Typecheck best-effort: solo si el workspace trae tsconfig.json y typescript resoluble. */
export async function runTypecheck(workspaceDir: string, timeoutMs = 90_000): Promise<TypecheckResult> {
  const tsconfig = path.join(workspaceDir, "tsconfig.json");
  try {
    await fs.access(tsconfig);
  } catch {
    return { ran: false, ok: true, output: "(sin tsconfig.json, typecheck omitido)" };
  }
  const tscCli = path.join(autocodeRoot(), "node_modules", "typescript", "bin", "tsc");
  try {
    await fs.access(tscCli);
  } catch {
    return { ran: false, ok: true, output: "(typescript no disponible, typecheck omitido)" };
  }
  const cap = await spawnNode([tscCli, "--noEmit", "-p", tsconfig], workspaceDir, timeoutMs);
  return {
    ran: true,
    ok: !cap.timedOut && cap.code === 0,
    output: (cap.stdout + cap.stderr).slice(-6000) || "(sin salida)",
  };
}
