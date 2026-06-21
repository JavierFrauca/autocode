import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { llmContext } from "../llm/context.js";
import { log } from "../log.js";
import { ensureAppDeps, runPackage } from "./qa-exec.js";
import { getArchitecture } from "../architecture.js";
import { buildDeployBundle } from "./deploy-bundle.js";

/**
 * Agente PACKAGER: prepara la app de escritorio para DISTRIBUIRLA. El usuario final (no técnico) no
 * sabe compilar; este agente genera un INSTALADOR NSIS (.exe) con electron-builder que se instala con
 * doble clic. Bajo demanda (botón "Preparar para distribuir"), no en cada build.
 *
 * No hay LLM aquí: es trabajo de toolchain (instalar deps → electron-vite build → electron-builder).
 * Se modela como agente para reusar la cola/cancelación del runner y verse en el visor de actividad.
 * El resultado va a `agent_runs.output` ({ ok, installerPath } | { ok:false, error, log }); la UI lo
 * sondea. Como no requiere gate, el run acaba en "applied".
 */
export interface PackagerOutput {
  ok: boolean;
  /** "installer" = .exe de escritorio; "bundle" = .zip de despliegue (cliente/servidor). */
  kind?: "installer" | "bundle";
  installerPath?: string;
  /** Ruta del .zip de despliegue (apps cliente/servidor). */
  bundlePath?: string;
  error?: string;
  log?: string;
}

export const runPackager = {
  async run(_runId: string, projectId: string, _input: unknown, _cfg: AppConfig): Promise<{ output: PackagerOutput }> {
    const project = (
      await db().select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1)
    )[0];
    if (!project) throw new Error("proyecto no encontrado");

    const ws = path.join(project.rootPath, "_app");
    if (!existsSync(path.join(ws, "package.json"))) {
      return { output: { ok: false, error: "Todavía no hay una app construida que empaquetar. Construye una versión primero." } };
    }

    const appType = (await getArchitecture(projectId))?.appType ?? "electron";

    // ── Cliente/servidor o servicio API → PAQUETE DE DESPLIEGUE (.zip con Dockerfile + compose) ──
    if (appType === "server" || appType === "api") {
      try {
        const r = await buildDeployBundle(ws, project.rootPath, project.name);
        log.info("packager", "paquete de despliegue generado", { projectId, bundlePath: r.bundlePath });
        return { output: { ok: true, kind: "bundle", bundlePath: r.bundlePath } };
      } catch (e: any) {
        return { output: { ok: false, error: `No se pudo generar el paquete de despliegue: ${String(e?.message ?? e).slice(0, 200)}` } };
      }
    }
    if (appType === "mcp") {
      return { output: { ok: false, error: "Un servidor MCP se distribuye registrándolo en el cliente (Claude Desktop/Cursor) o publicándolo; no genera instalador." } };
    }

    // Aborto cooperativo: el signal del runner (cancelar) llega por AsyncLocalStorage.
    const signal = llmContext.getStore()?.signal;

    // electron-builder es devDependency → necesita node_modules. En el host (empaquetar requiere red).
    const deps = await ensureAppDeps(ws, { timeoutMs: 600_000 });
    if (!deps.ok) {
      log.warn("packager", "no se pudieron instalar las dependencias para empaquetar", { projectId });
      return { output: { ok: false, error: "No pude instalar las dependencias necesarias para empaquetar.", log: deps.output } };
    }
    if (signal?.aborted) return { output: { ok: false, error: "Cancelado." } };

    const result = await runPackage(ws, project.name, { signal });
    if (!result.ok) {
      log.warn("packager", "el empaquetado no terminó", { projectId, skipped: result.skipped });
      return { output: { ok: false, error: result.skipped ?? "El empaquetado no terminó. Revisa el registro para ver qué pasó.", log: result.output } };
    }

    log.info("packager", "instalador generado", { projectId, installerPath: result.installerPath });
    return { output: { ok: true, kind: "installer", installerPath: result.installerPath } };
  },
};
