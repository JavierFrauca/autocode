import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, promises as fs, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { log } from "../log.js";

/**
 * "Máquina del tiempo" del proyecto, oculta tras git. El usuario NO ve git: ve
 * "versiones que funcionan" y un botón para volver atrás. Cada commit se hace SOLO
 * cuando el QA pasa a verde, así cada versión guardada es un estado verificado-bueno.
 *
 * Git se resuelve por orden: (1) el git portátil ya descargado en userData,
 * (2) el git del sistema (entorno de desarrollo o usuario que ya lo tiene), y si no hay
 * ninguno, (3) en Windows se DESCARGA MinGit a userData la primera vez (sin instalar nada,
 * sin admin; requiere internet solo esa vez). Así el instalador no carga el binario.
 * La identidad se pasa por -c en cada commit: nunca tocamos la config global del usuario.
 */

const IDENTITY = ["-c", "user.name=AutoCode", "-c", "user.email=autocode@local"];
const SEP = "\x1f"; // Unit Separator: delimitador inequívoco para parsear el log.

// MinGit portátil (solo Windows). Variante busybox: ~la mitad de tamaño, trae lo
// necesario para init/add/commit/log/reset/checkout-index/clean.
const MINGIT_VERSION = "2.47.1";
const MINGIT_ASSET = `MinGit-${MINGIT_VERSION}-busybox-64-bit.zip`;
const MINGIT_URL = `https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/${MINGIT_ASSET}`;

/** Carpeta escribible (sin admin) del usuario. null en tests/no-Electron. */
function userDataDir(): string | null {
  try {
    // require diferido: en tests (vitest) Electron no está en runtime y app.getPath lanza.
    const { app } = require("electron");
    return app?.getPath?.("userData") ?? null;
  } catch {
    return null;
  }
}

/** git.exe del MinGit ya descargado en userData, si existe. */
function downloadedGitPath(): string | null {
  if (process.platform !== "win32") return null;
  const base = userDataDir();
  if (!base) return null;
  const candidates = [
    path.join(base, "git", "cmd", "git.exe"),
    path.join(base, "git", "bin", "git.exe"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** ¿Funciona el git del sistema (dev o usuario que ya lo tiene instalado)? */
function systemGitWorks(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", ["--version"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Descarga MinGit a userData/git la primera vez que se necesita y no hay git en el sistema.
 * Idempotente. Devuelve la ruta a git.exe, o null si falla (p. ej. sin red).
 */
async function downloadMinGit(): Promise<string | null> {
  const base = userDataDir();
  if (!base) return null;
  const target = path.join(base, "git");
  const exe = path.join(target, "cmd", "git.exe");
  if (existsSync(exe)) return exe;
  try {
    mkdirSync(target, { recursive: true });
    const zipPath = path.join(target, MINGIT_ASSET);
    log.info("git", "descargando git portátil (primera vez)…", { url: MINGIT_URL });
    const res = await fetch(MINGIT_URL);
    if (!res.ok || !res.body) {
      log.warn("git", "no se pudo descargar git portátil", { status: res.status });
      return null;
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zipPath));
    new AdmZip(zipPath).extractAllTo(target, true);
    rmSync(zipPath, { force: true });
    if (!existsSync(exe)) {
      log.warn("git", "git portátil descargado pero no se halló cmd/git.exe");
      return null;
    }
    log.info("git", "git portátil listo", { exe });
    return exe;
  } catch (e) {
    log.warn("git", "fallo descargando git portátil", { error: String(e) });
    return null;
  }
}

let _gitBin: string | null = null;
let _resolving: Promise<string> | null = null;

/**
 * Resuelve qué git usar (memoizado; una sola descarga aunque se llame en paralelo).
 * Orden: descargado en userData → git del sistema → descargar MinGit (Windows, 1ª vez).
 * Último recurso "git": las operaciones fallarán con gracia (se registra el warn).
 */
function resolveGit(): Promise<string> {
  if (_gitBin) return Promise.resolve(_gitBin);
  if (_resolving) return _resolving;
  _resolving = (async () => {
    const dl = downloadedGitPath();
    if (dl) return (_gitBin = dl);
    if (await systemGitWorks()) return (_gitBin = "git");
    if (process.platform === "win32") {
      const exe = await downloadMinGit();
      if (exe) return (_gitBin = exe);
    }
    return (_gitBin = "git");
  })();
  return _resolving;
}

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitResult> {
  const bin = await resolveGit();
  return new Promise((resolve) => {
    const child = spawn(bin, ["-C", cwd, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(e) }); });
  });
}

/** ¿Hay git disponible (descargado, sistema o se pudo descargar)? */
export async function gitAvailable(): Promise<boolean> {
  const bin = await resolveGit();
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

const GITIGNORE = `# Generado por AutoCode — no editar
node_modules/
dist/
build/
out/
release/
.qa-vitest-result.json
.preview*
*.sqlite
*.sqlite-shm
*.sqlite-wal
*.log
.DS_Store
Thumbs.db
`;

/** Inicializa el repo del proyecto si no existe (idempotente) y deja un commit inicial. */
export async function ensureRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (!existsSync(path.join(dir, ".git"))) {
    const init = await runGit(dir, ["init"]);
    if (init.code !== 0) {
      log.warn("git", "git init falló (¿git no disponible?)", { dir, code: init.code, stderr: init.stderr.slice(0, 300) });
    }
  }
  const giPath = path.join(dir, ".gitignore");
  if (!existsSync(giPath)) {
    await fs.writeFile(giPath, GITIGNORE, "utf-8");
  }
  // Commit inicial VACÍO (baseline) solo si el repo aún no tiene ninguno. No capturamos
  // ficheros aquí: la primera versión real la crea el primer commitGreen, así cada punto
  // de restauración corresponde a un estado verificado-bueno.
  const head = await runGit(dir, ["rev-parse", "--verify", "HEAD"]);
  if (head.code !== 0) {
    await runGit(dir, [...IDENTITY, "commit", "--allow-empty", "-m", "Inicio del proyecto"]);
  }
}

/**
 * Crea un punto de restauración (commit) con todo el estado actual. Pensado para
 * llamarse cuando el QA pasa a verde. Devuelve el hash, o null si no había cambios.
 */
export async function commitGreen(dir: string, label: string): Promise<string | null> {
  await ensureRepo(dir);
  await runGit(dir, ["add", "-A"]);

  const status = await runGit(dir, ["status", "--porcelain"]);
  if (status.code === 0 && status.stdout.trim() === "") {
    return null; // nada que guardar
  }

  const msg = `✅ Versión que funciona — ${label}`;
  const commit = await runGit(dir, [...IDENTITY, "commit", "-m", msg]);
  if (commit.code !== 0) {
    log.warn("git", "no se pudo guardar la versión (commit falló)", {
      dir,
      code: commit.code,
      stderr: commit.stderr.slice(0, 300),
    });
    return null;
  }

  const hash = await runGit(dir, ["rev-parse", "HEAD"]);
  return hash.code === 0 ? hash.stdout.trim() : null;
}

export interface RestorePoint {
  hash: string;
  isoDate: string;
  subject: string;
}

/** Lista los puntos de restauración (versiones verdes), del más reciente al más antiguo. */
export async function listVersions(dir: string, limit = 50): Promise<RestorePoint[]> {
  if (!existsSync(path.join(dir, ".git"))) return [];
  const r = await runGit(dir, ["log", `--max-count=${limit}`, "--pretty=format:%H%x1f%cI%x1f%s"]);
  if (r.code !== 0 || !r.stdout.trim()) return [];
  return r.stdout
    .split("\n")
    .map((line) => {
      const [hash, isoDate, subject] = line.split(SEP);
      return { hash: hash ?? "", isoDate: isoDate ?? "", subject: subject ?? "" };
    })
    .filter((v) => v.hash);
}

/**
 * Vuelve a una versión anterior restaurando su árbol como un COMMIT NUEVO en la punta.
 * Ventajas frente a `reset --hard`: (1) se conserva TODO el historial — las versiones
 * "deshechas" siguen visibles, así que el usuario puede REHACER volviendo a una posterior;
 * (2) no deja ramas de respaldo acumulándose. El trabajo a medias (sin guardar) se descarta.
 */
export async function restoreVersion(dir: string, hash: string): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(path.join(dir, ".git"))) return { ok: false, error: "el proyecto no tiene historial" };

  const valid = await runGit(dir, ["cat-file", "-e", `${hash}^{commit}`]);
  if (valid.code !== 0) return { ok: false, error: "esa versión no existe" };

  // Poner el índice y el árbol de trabajo exactamente como en <hash>...
  const rt = await runGit(dir, ["read-tree", hash]);
  if (rt.code !== 0) return { ok: false, error: rt.stderr.slice(0, 300) || "no se pudo leer la versión" };
  await runGit(dir, ["checkout-index", "-a", "-f"]);
  await runGit(dir, ["clean", "-fd"]); // quita ficheros que no están en <hash> (respeta .gitignore)

  // ...y registrarlo como un commit nuevo encima (preserva el historial hacia delante).
  await runGit(dir, ["add", "-A"]);
  const status = await runGit(dir, ["status", "--porcelain"]);
  if (status.stdout.trim() !== "") {
    const commit = await runGit(dir, [...IDENTITY, "commit", "-m", "↩️ Vuelta a una versión anterior"]);
    if (commit.code !== 0) return { ok: false, error: commit.stderr.slice(0, 300) || "no se pudo revertir" };
  }
  return { ok: true };
}
