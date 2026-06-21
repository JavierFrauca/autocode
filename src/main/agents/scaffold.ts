import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { app as electronApp } from "electron";
import type { AppType } from "@shared";
import { log } from "../log.js";

/**
 * Materialización DETERMINISTA del andamiaje dorado: el PROGRAMA escribe la estructura conocida-buena
 * (build, ventana, preload, CSP, electron-vite) dentro de `_app/`, en vez de confiar en que el LLM la
 * reproduzca. Esto elimina por construcción la clase de bugs estructurales que dejaban la app en blanco
 * (build `tsc` pelado sin copiar el html, CSP que se autobloquea, ruta de carga incorrecta…).
 *
 * El andamiaje (`templates/electron-app/`) está VERIFICADO: construye con electron-vite y renderiza.
 * Tras materializarlo, el agente solo añade dominio (src/main) y pantallas (src/renderer/src) ENCIMA.
 */

/** Subcarpeta de `templates/` con el andamiaje real (ficheros copiables) por tipo de app. */
const SCAFFOLD_DIR: Record<AppType, string | null> = {
  electron: "electron-app",
  mcp: "mcp-server",   // servidor MCP dorado (stdio + HTTP), verificado
  server: "server-app", // cliente/servidor dorado (Fastify sirve la SPA Vue + SQLite local + login + auditoría), verificado
  api: "api-server",   // servicio API/integración dorado (Fastify solo API + API key + auditoría + jobs), verificado
};

function templatesRoot(): string {
  // En tests (sin Electron) `electronApp` puede no estar: cae al árbol de fuentes.
  if (electronApp?.isPackaged) return path.join(process.resourcesPath, "templates");
  return path.resolve(__dirname, "../..", "templates");
}

const SKIP = new Set(["node_modules", "out", "dist", "release", ".git"]);

async function copyDir(src: string, dst: string, rel: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDir(from, to, r, out);
    } else {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      out.push(r);
    }
  }
}

/** ¿Hay un andamiaje (package.json) con el que el agente pueda construir? */
export function hasScaffold(ws: string): boolean {
  return existsSync(path.join(ws, "package.json"));
}

/**
 * "Reconstruir desde cero": vacía el workspace (código viejo) para forzar un andamiaje fresco. CONSERVA
 * `node_modules` (evita reinstalar y el típico bloqueo de su watcher) — `ensureAppDeps` lo reconcilia.
 * Tolerante a bloqueos: si un fichero/carpeta está EN USO (Windows), lo omite en vez de fallar, de modo
 * que el usuario no tenga que ir a cerrar procesos a mano. Devuelve cuánto borró y qué quedó en uso.
 */
export async function resetWorkspace(ws: string): Promise<{ removed: number; failed: string[] }> {
  let entries: string[] = [];
  try { entries = await fs.readdir(ws); } catch { return { removed: 0, failed: [] }; }
  let removed = 0;
  const failed: string[] = [];
  for (const name of entries) {
    if (name === "node_modules") continue; // se conserva; ensureAppDeps lo pone al día
    try {
      await fs.rm(path.join(ws, name), { recursive: true, force: true });
      removed++;
    } catch {
      failed.push(name);
    }
  }
  log.info("scaffold", "workspace reseteado (reconstruir desde cero)", { removed, enUso: failed.length });
  return { removed, failed };
}

/**
 * Copia el andamiaje dorado del tipo de app dentro de `ws`. Solo escribe ficheros que NO existan ya
 * (no pisa el trabajo del usuario/agente en reparación). Devuelve las rutas materializadas; [] si el
 * tipo no tiene andamiaje copiable o ya había uno.
 */
export async function materializeScaffold(ws: string, appType: AppType): Promise<string[]> {
  const sub = SCAFFOLD_DIR[appType];
  if (!sub) return [];
  const src = path.join(templatesRoot(), sub);
  if (!existsSync(src)) {
    log.warn("scaffold", "no se encontró el andamiaje en templates", { src, appType });
    return [];
  }
  const out: string[] = [];
  await fs.mkdir(ws, { recursive: true });
  await copyDir(src, ws, "", out);
  log.info("scaffold", "andamiaje dorado materializado", { appType, ficheros: out.length });
  return out;
}
