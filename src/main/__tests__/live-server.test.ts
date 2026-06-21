import { describe, expect, test } from "vitest";
import { promises as fs, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "@shared";
import { runBuilder } from "../agents/builder.js";

/**
 * DEMO EN VIVO — regenera una app CLIENTE/SERVIDOR sobre el andamiaje nuevo (Fastify + SPA Vue + SQLite)
 * a partir de los documentos de un proyecto real, la construye, la ARRANCA y comprueba que sirve la web.
 *   eval "$(ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/dump-config.cjs)"
 *   AUTOCODE_LIVE=1 AUTOCODE_PROJECT_DIR="C:/AutoCodeProjects/horas_de_convenio" \
 *     node node_modules/vitest/vitest.mjs run src/main/__tests__/live-server.test.ts
 */
const enabled = process.env.AUTOCODE_LIVE === "1" && !!process.env.AUTOCODE_LITELLM_KEY && !!process.env.AUTOCODE_PROJECT_DIR;

function stripFrontMatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}
function npm(args: string[], cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn("npm", args, { cwd, env: { ...process.env, CI: "1", NO_COLOR: "1" }, stdio: "ignore", shell: true });
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve(-1); }, timeoutMs);
    c.on("close", (code) => { clearTimeout(t); resolve(code ?? -1); });
    c.on("error", () => { clearTimeout(t); resolve(-1); });
  });
}
function freePort(): Promise<number> {
  return new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
}
async function readDocs(dir: string): Promise<string> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (["_app", ".git", "planes", "node_modules"].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.name.endsWith(".md")) out.push(`### ${path.relative(dir, abs)}\n${await fs.readFile(abs, "utf-8")}`);
    }
  }
  await walk(dir);
  return out.join("\n\n");
}

describe.runIf(enabled)("DEMO EN VIVO — app cliente/servidor (SQLite+SPA)", () => {
  test("materializa + el agente construye + build + arranca + sirve la web", async () => {
    const repo = process.cwd();
    const projectDir = process.env.AUTOCODE_PROJECT_DIR!;
    const ws = path.join(repo, ".tmp-server-live", "_app");
    await fs.rm(path.dirname(ws), { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(ws, { recursive: true });

    await fs.cp(path.join(repo, "templates", "server-app"), ws, { recursive: true });
    console.log("MATERIALIZED:", (await fs.readdir(ws)).join(", "));

    const inst = await npm(["install", "--no-audit", "--no-fund", "--no-progress"], ws, 300_000);
    console.log("NPM_INSTALL_EXIT:", inst);
    expect(inst).toBe(0);

    const cfg = {
      generation: {
        mode: "local", provider: "local",
        baseUrl: process.env.AUTOCODE_LITELLM_URL!, apiKey: process.env.AUTOCODE_LITELLM_KEY!,
        mainModel: process.env.AUTOCODE_CODE_MODEL!, fastModel: process.env.AUTOCODE_CODE_MODEL!,
      },
      projectsRoot: "", qdrantUrl: "http://localhost:6333",
    } as AppConfig;
    const systemPrompt = stripFrontMatter(readFileSync(path.join(repo, "prompts", "builder-system.md"), "utf-8"));
    const docs = await readDocs(projectDir);
    const plan = `DOCUMENTACIÓN DEL PROYECTO (lo que hay que construir):\n\n${docs.slice(0, 16_000)}\n\n` +
      "Construye la app sobre el andamiaje (Fastify sirve la SPA Vue + SQLite). Reemplaza el CRUD de ejemplo " +
      "'items' por el dominio real (entidades, servicios, rutas API en src/) y las pantallas reales en web/src. " +
      "No uses Postgres ni Docker. La app debe seguir ARRANCANDO y sirviendo la UI.";

    const res = await runBuilder(
      cfg, ws,
      { projectId: "hc-live", appType: "server", scaffolded: true, planContext: plan },
      { systemPrompt },
    );
    console.log("BUILDER_RESULT:", JSON.stringify(res));
    const files = (await listFiles(path.join(ws, "src"))).concat(await listFiles(path.join(ws, "web", "src")));
    console.log("AGENT_FILES:", files.length, files.slice(0, 40).join(", "));

    const build = await npm(["run", "build"], ws, 240_000);
    console.log("NPM_BUILD_EXIT:", build);

    // Arrancar el servidor y comprobar que sirve la web.
    let verdict = "NO_ARRANCO";
    if (existsSync(path.join(ws, "dist", "server.js"))) {
      const port = await freePort();
      const srv = spawn("node", ["dist/server.js"], { cwd: ws, env: { ...process.env, PORT: String(port), DB_FILE: path.join(ws, "demo.sqlite") }, shell: true, stdio: "ignore" });
      try {
        let up = false;
        for (let i = 0; i < 40 && !up; i++) {
          try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) up = true; } catch {}
          if (!up) await new Promise((r) => setTimeout(r, 400));
        }
        const html = up ? await (await fetch(`http://127.0.0.1:${port}/`)).text() : "";
        const servesSpa = html.includes('<div id="app">');
        console.log("SERVER_UP:", up, "SERVES_SPA:", servesSpa, "PORT:", port);
        if (up && servesSpa) {
          // screenshot de la web servida
          const shot = path.join(repo, ".tmp-server-live", "screenshot.png");
          await new Promise<void>((r) => {
            const cap = spawn("./node_modules/electron/dist/electron.exe", ["scripts/visual-capture.cjs", `--url=http://127.0.0.1:${port}/`, `--out=${shot}`, `--verdict=${shot}.json`, "--timeout=10000", "--w=1280", "--h=800"], { cwd: repo, stdio: "ignore" });
            cap.on("exit", () => r()); cap.on("error", () => r());
          });
          console.log("SCREENSHOT_PATH:", existsSync(shot) ? shot : "(no se generó)");
          verdict = "WEB_OK";
        }
      } finally {
        try { if (process.platform === "win32" && srv.pid) spawn("taskkill", ["/PID", String(srv.pid), "/T", "/F"], { shell: true }); else srv.kill(); } catch {}
      }
    }
    console.log("FINAL:", verdict);
    expect(res.cycles).toBeGreaterThan(0);
  }, 1_200_000);
});

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), r)));
    else out.push(r);
  }
  return out;
}
