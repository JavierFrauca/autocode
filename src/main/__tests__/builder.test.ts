import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import { runBuilder, type BuilderDeps } from "../agents/builder.js";
import type { ChatTool, ToolLoopResult } from "../llm/client.js";

/**
 * Verificación OFFLINE del motor del agente builder: ejercita el bucle de ciclos, el GATE
 * determinista real (escribir_fichero escribe de verdad → typecheckApp compila con el tsc real) y la
 * detección de estancamiento, SIN tocar el LLM. El "agente" es un guion: en cada ciclo escribe unos
 * ficheros usando las MISMAS tools que recibiría el modelo. Así probamos todo salvo la inteligencia
 * del modelo (cuya prueba —function-calling— necesita el gateway LiteLLM).
 */

// tsconfig deps-free → typecheckApp usa el tsc del host (sin Docker), hermético y rápido.
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, skipLibCheck: true, noEmit: true,
  },
  include: ["src/**/*"],
}, null, 2);

const GOOD = "export const sum = (a: number, b: number): number => a + b;\n";
const BAD = "export const sum = (a: number, b: number): number => a + 'no';\n"; // TS error

const cfg = { models: { code: { model: "fake" } } } as unknown as AppConfig;

/** Construye un toolLoop falso: por cada ciclo ejecuta su guion de escrituras vía la tool real. */
function scriptedDriver(scripts: Array<Array<{ ruta: string; contenido: string }>>): BuilderDeps["toolLoop"] {
  let cycle = 0;
  return async (_cfg, _role, _messages, tools: ChatTool[]): Promise<ToolLoopResult> => {
    const write = tools.find((t) => t.name === "escribir_fichero");
    if (!write) throw new Error("falta la tool escribir_fichero");
    const used: string[] = [];
    const script = scripts[cycle] ?? [];
    for (const f of script) {
      await write.run({ ruta: f.ruta, contenido: f.contenido });
      used.push("escribir_fichero");
    }
    cycle++;
    return { messages: [], toolsUsed: used, supported: true };
  };
}

let ws: string;
beforeEach(async () => {
  ws = path.join(os.tmpdir(), `autocode-builder-${ulid().toLowerCase()}`);
  await fs.mkdir(ws, { recursive: true });
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

const baseOpts = { projectId: "p", appType: "server" as const };

describe("runBuilder (motor del agente único, offline)", () => {
  it("ciclo 0 deja todo compilando → status green", async () => {
    const toolLoop = scriptedDriver([
      [{ ruta: "tsconfig.json", contenido: TSCONFIG }, { ruta: "src/index.ts", contenido: GOOD }],
    ]);
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("green");
    expect(res.compiledGreen).toBe(true);
    expect(res.compileErrors).toBe(0);
    expect(res.cycles).toBe(1);
  }, 30_000);

  it("primer ciclo en rojo, segundo lo arregla → green tras 2 ciclos (gate realimenta)", async () => {
    const toolLoop = scriptedDriver([
      [{ ruta: "tsconfig.json", contenido: TSCONFIG }, { ruta: "src/index.ts", contenido: BAD }],
      [{ ruta: "src/index.ts", contenido: GOOD }],
    ]);
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("green");
    expect(res.cycles).toBe(2);
  }, 40_000);

  it("nunca arregla el error → se detecta estancamiento (status stalled)", async () => {
    // Solo el ciclo 0 escribe (con error); los siguientes no mejoran nada.
    const toolLoop = scriptedDriver([
      [{ ruta: "tsconfig.json", contenido: TSCONFIG }, { ruta: "src/index.ts", contenido: BAD }],
    ]);
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("stalled");
    expect(res.compiledGreen).toBe(false);
    expect(res.compileErrors).toBeGreaterThan(0);
  }, 60_000);

  it("el modelo no soporta tools → status unsupported", async () => {
    const toolLoop: BuilderDeps["toolLoop"] = async () => ({ messages: [], toolsUsed: [], supported: false });
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("unsupported");
  }, 15_000);

  it("un error de compilación repetido dispara el aviso de 'cambia de estrategia' (no antes del 2º ciclo seguido)", async () => {
    // El usuario NO SABE PROGRAMAR: un estancamiento de compilación debe darle al agente más margen
    // (COMPILE_STALL_LIMIT) y, si el error se repite, un empujón explícito para que cambie de enfoque
    // en vez de repetir el mismo intento — nunca se le pide ayuda a la persona por esto.
    const seenMessages: string[] = [];
    let cycle = 0;
    const toolLoop: BuilderDeps["toolLoop"] = async (_cfg, _role, messages, tools: ChatTool[]) => {
      const userMsg = messages.find((m) => m.role === "user");
      if (userMsg) seenMessages.push(String(userMsg.content));
      if (cycle === 0) {
        const write = tools.find((t) => t.name === "escribir_fichero")!;
        await write.run({ ruta: "tsconfig.json", contenido: TSCONFIG });
        await write.run({ ruta: "src/index.ts", contenido: BAD });
      }
      cycle++;
      return { messages: [], toolsUsed: [], supported: true };
    };
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("stalled");
    // 1ª continuación (tras el 1er rojo): todavía no ha "repetido" nada → sin aviso de estrategia.
    expect(seenMessages[1]).not.toContain("CAMBIA DE ESTRATEGIA");
    // 2ª continuación en adelante: mismo error 2 ciclos seguidos → aviso explícito.
    expect(seenMessages[2]).toContain("CAMBIA DE ESTRATEGIA");
    expect(seenMessages[2]).toContain("MISMO ERROR");
    // Aguanta más de los 3 ciclos que se usaban antes para fases de UI/tests (le da margen extra al agente).
    expect(res.cycles).toBeGreaterThan(3);
  }, 30_000);

  it("reporta el progreso por ciclo (onCycle/onGate)", async () => {
    const gates: Array<{ compiledGreen: boolean }> = [];
    const toolLoop = scriptedDriver([
      [{ ruta: "tsconfig.json", contenido: TSCONFIG }, { ruta: "src/index.ts", contenido: GOOD }],
    ]);
    const res = await runBuilder(
      cfg, ws,
      { ...baseOpts, progress: { onGate: (_c, info) => { gates.push({ compiledGreen: info.compiledGreen }); } } },
      { toolLoop, systemPrompt: "test" },
    );
    expect(res.status).toBe("green");
    expect(gates.length).toBe(1);
    expect(gates[0].compiledGreen).toBe(true);
  }, 30_000);

  it("mockupsUnread avisa de pantallas construidas sin consultar leer_maqueta", async () => {
    const toolLoop: BuilderDeps["toolLoop"] = async (_cfg, _role, _messages, tools: ChatTool[]) => {
      const write = tools.find((t) => t.name === "escribir_fichero")!;
      const leerMaqueta = tools.find((t) => t.name === "leer_maqueta")!;
      await write.run({ ruta: "tsconfig.json", contenido: TSCONFIG });
      await write.run({ ruta: "src/index.ts", contenido: GOOD });
      await leerMaqueta.run({ pantalla: "cliente-lista" }); // solo se consulta esta pantalla
      return { messages: [], toolsUsed: ["escribir_fichero", "escribir_fichero", "leer_maqueta"], supported: true };
    };
    const res = await runBuilder(cfg, ws, baseOpts, {
      toolLoop, systemPrompt: "test",
      resolveRootPath: async () => "/fake/root",
      listProjectScreens: async () => [
        { slug: "cliente-lista", rel: "pantallas/cliente-lista.md", kind: "pagina", parent: null, hasMockup: true },
        { slug: "factura-lista", rel: "pantallas/factura-lista.md", kind: "pagina", parent: null, hasMockup: true },
      ],
    });
    expect(res.status).toBe("green");
    expect(res.mockupsUnread).toEqual(["factura-lista"]);
  }, 30_000);

  it("mockupsUnread vacío si no hay projectId resoluble (best-effort, no bloquea)", async () => {
    const toolLoop = scriptedDriver([
      [{ ruta: "tsconfig.json", contenido: TSCONFIG }, { ruta: "src/index.ts", contenido: GOOD }],
    ]);
    const res = await runBuilder(cfg, ws, baseOpts, { toolLoop, systemPrompt: "test" });
    expect(res.status).toBe("green");
    expect(res.mockupsUnread).toEqual([]);
  }, 30_000);
});
