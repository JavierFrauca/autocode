import { describe, expect, test } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import { runBuilder } from "../agents/builder.js";

/**
 * Prueba EN VIVO del agente builder con el modelo real (vía LiteLLM). Construye un proyecto TS mínimo
 * en un workspace temporal y comprueba que lo deja compilando en verde — ejercitando el bucle real
 * (tool-calling del modelo) + el gate determinista. Gateada por env (consume tokens y necesita gateway):
 *   eval "$(ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/dump-config.cjs)"
 *   AUTOCODE_LIVE=1 node node_modules/vitest/vitest.mjs run src/main/__tests__/live-build.test.ts
 */
const enabled = process.env.AUTOCODE_LIVE === "1" && !!process.env.AUTOCODE_LITELLM_KEY;

function stripFrontMatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}

describe.runIf(enabled)("runBuilder EN VIVO (modelo real)", () => {
  test("construye un proyecto TS mínimo y lo deja compilando en verde", async () => {
    const cfg = {
      generation: {
        mode: "local", provider: "local",
        baseUrl: process.env.AUTOCODE_LITELLM_URL!, apiKey: process.env.AUTOCODE_LITELLM_KEY!,
        mainModel: process.env.AUTOCODE_CODE_MODEL!, fastModel: process.env.AUTOCODE_CODE_MODEL!,
      },
      projectsRoot: "", qdrantUrl: "http://localhost:6333",
    } as AppConfig;

    const ws = path.join(os.tmpdir(), `autocode-live-${ulid().toLowerCase()}`);
    await fs.mkdir(ws, { recursive: true });
    const systemPrompt = stripFrontMatter(readFileSync(path.join(process.cwd(), "prompts", "builder-system.md"), "utf-8"));

    const plan = [
      "OBJETIVO ACOTADO (sin dependencias externas, sin Docker, sin tests, sin documentación):",
      "Crea un proyecto TypeScript mínimo que compile en verde con estos 3 ficheros:",
      '- package.json con name, version y "scripts": { "typecheck": "tsc --noEmit" }. NO declares "dependencies".',
      '- tsconfig.json: { "compilerOptions": { "target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"skipLibCheck":true }, "include":["src/**/*"] }',
      "- src/index.ts con: export function suma(a: number, b: number): number { return a + b }",
      "No llames a buscar_documentacion ni leer_plantilla (no hay proyecto): escribe los ficheros directamente y compila hasta verde.",
    ].join("\n");

    const res = await runBuilder(
      cfg, ws,
      { projectId: "live", appType: "server", planContext: plan },
      { systemPrompt },
    );
    const files = await fs.readdir(ws).catch(() => []);
    let srcFiles: string[] = [];
    try { srcFiles = await fs.readdir(path.join(ws, "src")); } catch {}
    console.log("LIVE RESULT:", JSON.stringify(res));
    console.log("WS FILES:", files, "src:", srcFiles);
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});

    expect(res.cycles).toBeGreaterThan(0);
    expect(res.status).toBe("green");
  }, 240_000);
});
