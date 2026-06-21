import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { appWorkspace } from "../agents/code-workspace.js";
import { ensureAppDeps, runBuild } from "../agents/qa-exec.js";
import { getArchitecture } from "../architecture.js";
import { childEnv } from "../util/proc-env.js";
import { log } from "../log.js";

/**
 * Previsualización "Probar la aplicación": AutoCode INSTALA y ARRANCA la app generada en local para que
 * un usuario no técnico la USE y la valide, sin tocar consola:
 *  - web (server): construye y levanta el servidor con SQLite embebido (sin Docker ni Postgres) y abre
 *    la URL en el navegador del sistema.
 *  - escritorio (electron): la arranca en modo desarrollo (npm run dev), que abre su propia ventana.
 * El proceso hijo se rastrea por proyecto para poder pararlo (en Windows se mata el árbol entero).
 */

interface Credenciales {
  email: string;
  password: string;
}
interface Preview {
  proc: ChildProcess;
  url: string | null; // web: http://localhost:PORT; escritorio: null (abre su propia ventana)
  port: number;
  kind: "web" | "desktop";
  // Web con login obligatorio: credenciales del admin sembrado para que el usuario pueda entrar a probar.
  credenciales?: Credenciales;
  // Servicio API: la API key sembrada (de un solo uso) para que el usuario pruebe los endpoints.
  apiKey?: string;
}
const previews = new Map<string, Preview>();

/**
 * Contraseña FIJA del admin de prueba (la misma en todos los proyectos y en cada "Probar"). Es un preview
 * LOCAL en 127.0.0.1 de una herramienta monopuesto, así que la aleatoriedad no aporta seguridad y SÍ daba
 * dolor: un usuario no técnico tecleaba a mano un hex de 12 caracteres ("39cd8191633b") y fallaba; y al
 * "Reconstruir desde cero" se borraba el fichero del secreto y se generaba OTRA clave mientras el usuario
 * seguía probando la vieja → "no me deja entrar". Fija + sin caracteres ambiguos + copiable en la UI =
 * entra siempre. El seed (auth/seed.ts) la fija en cada arranque vía SEED_ADMIN_PASSWORD, así que aunque la
 * BD del preview persista, la clave del admin siempre vuelve a ser esta. La app REAL gestiona sus usuarios.
 */
const PREVIEW_ADMIN_PASSWORD = "autocode-2026";

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

/** Sondea a que el servidor responda (en /api/health o /health). Sale antes si el proceso muere. */
async function waitHealth(url: string, timeoutMs: number, hasExited: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited()) return false; // el proceso se cerró: no tiene sentido seguir esperando
    for (const p of ["/api/health", "/health"]) {
      try { if ((await fetch(`${url}${p}`)).ok) return true; } catch { /* aún no escucha */ }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Secreto ESTABLE por proyecto: se genera UNA vez y se reusa en cada "Probar" (lo guarda en un fichero
 * junto a la BD del preview). Antes se generaba aleatorio en CADA arranque y, como la BD persiste, el seed
 * machacaba la clave del admin → "la 1ª vez entro, las demás no". Ahora las credenciales que mostramos
 * siguen siendo válidas entre arranques. Se borran al "Reconstruir desde cero" (resetWorkspace vacía _app).
 */
function persistentSecret(ws: string, file: string, gen: () => string): string {
  const abs = path.join(ws, file);
  try {
    const v = readFileSync(abs, "utf-8").trim();
    if (v) return v;
  } catch { /* aún no existe */ }
  const v = gen();
  try { writeFileSync(abs, v, "utf-8"); } catch { /* best-effort: si no se puede persistir, al menos arranca */ }
  return v;
}

/** ¿La app está cableada a Postgres (no es el andamiaje SQLite del preview)? */
function usesPostgres(ws: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ws, "package.json"), "utf-8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return (!!deps.postgres || !!deps.pg || !!deps["pg-promise"]) && !deps["better-sqlite3"];
  } catch {
    return false;
  }
}

async function projectRoot(projectId: string): Promise<string | null> {
  const rows = await db()
    .select({ rootPath: schema.projects.rootPath })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.rootPath ?? null;
}

export function stopPreview(projectId: string): void {
  const p = previews.get(projectId);
  if (!p) return;
  const pid = p.proc.pid;
  try {
    if (process.platform === "win32" && pid) {
      // npm → electron-vite → electron es un ÁRBOL de procesos; matar solo el shell deja la ventana de
      // Electron (y Vite) viva. taskkill /T mata el árbol entero para que "Parar" funcione de verdad.
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      p.proc.kill();
    }
  } catch { /* ya muerto */ }
  previews.delete(projectId);
}

/**
 * Mata TODOS los previews vivos. Se llama al cerrar AutoCode: si no, los servidores que lanzó (node
 * dist/server.js) quedan HUÉRFANOS (en Windows el hijo no muere con el padre) y se van acumulando entre
 * reinicios → varios servidores a la vez, puertos distintos, confusión al entrar. Síncrono y a prueba de
 * fallos (cada parada va en su try) para poder usarse en el handler de cierre del proceso.
 */
export function stopAllPreviews(): void {
  for (const projectId of [...previews.keys()]) {
    try { stopPreview(projectId); } catch { /* seguir matando el resto */ }
  }
}

/**
 * Instala, construye y ARRANCA la app generada para que el usuario la VEA:
 *  - web (server): levanta el servidor con SQLite y devuelve la URL (la abre el navegador).
 *  - escritorio (electron): construye y lanza la app, que abre su propia ventana.
 *  - mcp: no se "abre" (se conecta a un cliente) → error explicativo.
 */
export async function startPreview(
  projectId: string,
): Promise<{ url: string | null; kind: "web" | "desktop"; credenciales?: Credenciales; apiKey?: string }> {
  const existing = previews.get(projectId);
  if (existing) return { url: existing.url, kind: existing.kind, credenciales: existing.credenciales, apiKey: existing.apiKey };

  const root = await projectRoot(projectId);
  if (!root) throw new Error("proyecto no encontrado");
  const ws = appWorkspace(root);

  const appType = (await getArchitecture(projectId))?.appType ?? "server";
  if (appType === "mcp") {
    throw new Error("Un servidor MCP no se 'abre': se prueba conectándolo a un cliente (Claude Desktop, Cursor…).");
  }

  const deps = await ensureAppDeps(ws); // host (sin Docker) → compila los nativos para node
  if (!deps.ok && !deps.skipped) throw new Error(`no se pudieron instalar las dependencias: ${deps.output.slice(-200)}`);

  // ── Escritorio: arrancar en modo desarrollo (npm run dev → electron-vite dev) ──
  // electron-vite dev compila main/preload y sirve el renderer con Vite, y abre la ventana de Electron
  // desde el código. No necesita un build de producción previo: es más rápido y tolerante que
  // build + preview, y es el arranque natural para "probar" la app mientras se desarrolla.
  if (appType === "electron") {
    // childEnv: sin ELECTRON_RENDERER_URL heredada, si no la ventana de la app cargaría la UI de
    // AutoCode (AutoCode en dev exporta esa var con su propio servidor Vite). Ver util/proc-env.ts.
    const proc = spawn("npm", ["run", "dev"], { cwd: ws, env: childEnv(), shell: true, stdio: "ignore" });
    previews.set(projectId, { proc, url: null, port: 0, kind: "desktop" });
    proc.on("exit", () => previews.delete(projectId));
    log.info("preview", "app de escritorio lanzada en modo dev (npm run dev)", { projectId });
    return { url: null, kind: "desktop" };
  }

  // ── Web: build + arrancar servidor con SQLite ──
  // El preview arranca con SQLite. Si la app está cableada a Postgres (es del andamiaje VIEJO, no del
  // SQLite+SPA), no va a arrancar aquí → avisar claro EN EL ACTO en vez de colgarse 25s esperando.
  if (usesPostgres(ws)) {
    throw new Error(
      "Esta app usa PostgreSQL y no se generó con el andamiaje de previsualización (Fastify + SQLite + SPA). " +
        "Para probarla aquí, regénerala desde cero con la versión actual (botón «Reconstruir desde cero»); " +
        "o reparte el «Paquete de despliegue» (Docker), que sí monta su base de datos.",
    );
  }

  const build = await runBuild(ws, appType); // server: vite (frontend) + tsc; api: tsc → dist/
  if (build.ran && !build.ok) throw new Error(`la app no construye:\n${build.output.slice(-400)}`);
  if (!existsSync(path.join(ws, "dist", "server.js"))) {
    throw new Error("el build no produjo dist/server.js — esta app no tiene la estructura del andamiaje (regénerala desde cero).");
  }

  const port = await freePort();
  const url = `http://localhost:${port}`;
  const esApi = appType === "api";
  // Apps web = login OBLIGATORIO → admin sembrado para mostrar sus credenciales. Servicio API = API KEY.
  // La contraseña del admin de prueba es FIJA (ver PREVIEW_ADMIN_PASSWORD): el seed la vuelve a fijar en
  // cada arranque, así que entra siempre y no depende de ningún fichero (sobrevive a "Reconstruir desde
  // cero"). La API key sí es un secreto estable por proyecto (se copia/pega, no se teclea a mano).
  const credenciales: Credenciales = {
    email: "admin@example.com",
    password: PREVIEW_ADMIN_PASSWORD,
  };
  const apiKey = persistentSecret(ws, ".preview-apikey", () => randomBytes(12).toString("hex"));
  const env = esApi
    ? { PORT: String(port), DB_FILE: path.join(ws, ".preview.sqlite"), API_KEY: apiKey }
    : {
        PORT: String(port),
        DB_FILE: path.join(ws, ".preview.sqlite"),
        AUTH_SECRET: persistentSecret(ws, ".preview-authsecret", () => randomBytes(32).toString("hex")),
        SEED_ADMIN_EMAIL: credenciales.email,
        SEED_ADMIN_PASSWORD: credenciales.password,
      };
  let stderr = "";
  let exitCode: number | null = null;
  const proc = spawn("node", ["dist/server.js"], {
    cwd: ws,
    env: childEnv(env),
    shell: true,
    stdio: ["ignore", "ignore", "pipe"], // capturamos stderr para explicar si se cae al arrancar
  });
  proc.stderr?.on("data", (d) => { stderr += d.toString(); });
  previews.set(projectId, { proc, url, port, kind: "web", credenciales: esApi ? undefined : credenciales, apiKey: esApi ? apiKey : undefined });
  proc.on("exit", (code) => { exitCode = code ?? -1; previews.delete(projectId); });

  const ok = await waitHealth(url, 25_000, () => exitCode !== null);
  if (!ok) {
    stopPreview(projectId);
    if (exitCode !== null) {
      throw new Error(`La app se cerró nada más arrancar (código ${exitCode}).\n${stderr.slice(-500) || "Sin más detalle en la salida."}`);
    }
    throw new Error(`El servidor no respondió a tiempo.\n${stderr.slice(-400) || "Revisa que la app arranque y exponga /api/health o /health."}`);
  }
  log.info("preview", esApi ? "servicio API en marcha" : "app web en marcha", { projectId, url });
  return { url, kind: "web", credenciales: esApi ? undefined : credenciales, apiKey: esApi ? apiKey : undefined };
}

export async function registerPreviewRoutes(app: FastifyInstance): Promise<void> {
  // Arranca la app y la abre en el navegador del sistema. Devuelve la URL (para mostrarla / reabrir).
  app.post("/api/projects/:id/preview/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const { url, kind, credenciales, apiKey } = await startPreview(id);
      if (url) {
        // Web/API: abrir en el navegador del sistema. (Escritorio: la app abre su propia ventana.)
        try {
          const { shell } = await import("electron");
          await shell.openExternal(url);
        } catch (e) {
          log.warn("preview", "no se pudo abrir el navegador (la app sigue en marcha)", { err: e });
        }
      }
      return { ok: true, url, kind, credenciales, apiKey };
    } catch (e: any) {
      return reply.code(500).send({ error: String(e?.message ?? e) });
    }
  });

  app.post("/api/projects/:id/preview/stop", async (req) => {
    const { id } = req.params as { id: string };
    stopPreview(id);
    return { ok: true };
  });

  app.get("/api/projects/:id/preview/status", async (req) => {
    const { id } = req.params as { id: string };
    const p = previews.get(id);
    return { running: !!p, url: p?.url ?? null, kind: p?.kind ?? null, credenciales: p?.credenciales ?? null, apiKey: p?.apiKey ?? null };
  });
}
