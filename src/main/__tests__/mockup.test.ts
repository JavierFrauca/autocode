import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";
import type { AppConfig } from "@shared";
import {
  ensureMockupForScreen,
  ensureMockupsForScreens,
  generateMockupHtml,
  isMockupStale,
  isScreenDoc,
  mockupPathFor,
  paletteBlock,
  specBodyHash,
  stripHtmlFences,
  type MockupDeps,
} from "../agents/mockup.js";
import { isDocPath } from "../papers/ingest.js";

/**
 * Verificación OFFLINE del maquetador SIN LLM: el `chatFn` se inyecta guionizado y el rootPath se
 * resuelve a un tmp dir. Probamos generar / skip-si-existe / force / no-op fuera de pantallas /
 * stub-sin-contenido / staleness, y que el `.preview.html` queda FUERA del índice (`isDocPath`).
 */

const cfg = {} as AppConfig;
const HTML = "<!doctype html><html><body><h1>Login</h1></body></html>";
const SPEC = "# Pantalla de Login\n\n## Objetivo\nPermitir al usuario entrar con email y contraseña.\n\n## Campos\n- Email\n- Contraseña\n- Botón Entrar\n";

let ws: string;
let calls: number;

function deps(html = HTML): MockupDeps {
  calls = 0;
  return {
    systemPrompt: "test",
    resolveRootPath: async () => ws,
    chatFn: async () => {
      calls++;
      return { content: html };
    },
  };
}

async function writeScreen(rel: string, body: string): Promise<void> {
  const abs = path.join(ws, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf-8");
}

beforeEach(async () => {
  ws = path.join(os.tmpdir(), `autocode-mockup-${ulid().toLowerCase()}`);
  await fs.mkdir(ws, { recursive: true });
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe("helpers puros", () => {
  it("isScreenDoc reconoce solo pantallas/*.md", () => {
    expect(isScreenDoc("pantallas/login.md")).toBe(true);
    expect(isScreenDoc("pantallas/sub/login.md")).toBe(true);
    expect(isScreenDoc("reglas/RN-001.md")).toBe(false);
    expect(isScreenDoc("pantallas/login.preview.html")).toBe(false);
  });

  it("mockupPathFor cambia .md por .preview.html", () => {
    expect(mockupPathFor("pantallas/login.md")).toBe("pantallas/login.preview.html");
  });

  it("el .preview.html NO es indexable (queda fuera de Qdrant)", () => {
    expect(isDocPath("pantallas/login.md")).toBe(true);
    expect(isDocPath("pantallas/login.preview.html")).toBe(false);
  });

  it("stripHtmlFences quita fences y texto previo", () => {
    expect(stripHtmlFences("```html\n<!doctype html><html></html>\n```")).toBe("<!doctype html><html></html>");
    expect(stripHtmlFences("Aquí tienes:\n<!doctype html><b>x</b>")).toBe("<!doctype html><b>x</b>");
  });
});

describe("generateMockupHtml", () => {
  it("pasa el spec al chat y devuelve el HTML limpio", async () => {
    const out = await generateMockupHtml(cfg, SPEC, "electron", deps("```html\n" + HTML + "\n```"));
    expect(out).toBe(HTML);
    expect(calls).toBe(1);
  });

  it("inyecta la paleta del tipo de app como system (web = claro)", async () => {
    let captured: any[] = [];
    const out = await generateMockupHtml(cfg, SPEC, "server", {
      systemPrompt: "base",
      resolveRootPath: async () => ws,
      chatFn: async (_c, _r, messages) => { captured = messages; return { content: HTML }; },
    });
    expect(out).toBe(HTML);
    const systems = captured.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(systems).toContain("#4f46e5"); // acento del tema claro (server)
    expect(systems).not.toContain("#38bdf8"); // no el del tema oscuro
  });
});

describe("paletteBlock", () => {
  it("escritorio = tema oscuro slate; web = tema claro", () => {
    expect(paletteBlock("electron")).toContain("#0f172a");
    expect(paletteBlock("electron")).toContain("#38bdf8");
    expect(paletteBlock("server")).toContain("#f5f7fb");
    expect(paletteBlock("server")).toContain("#4f46e5");
  });
});

describe("ensureMockupsForScreens", () => {
  it("genera la maqueta de cada pantalla y es idempotente", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    await writeScreen("pantallas/panel.md", SPEC);
    const r1 = await ensureMockupsForScreens(cfg, "p", "electron", deps());
    expect(r1.total).toBe(2);
    expect(r1.generated).toBe(2);
    expect(calls).toBe(2);
    // 2ª pasada: ya existen → no regenera (no llama al LLM)
    const r2 = await ensureMockupsForScreens(cfg, "p", "electron", deps());
    expect(r2).toEqual({ total: 2, generated: 0 });
    expect(calls).toBe(0);
  });

  it("total 0 si no hay carpeta de pantallas", async () => {
    expect(await ensureMockupsForScreens(cfg, "p", "server", deps())).toEqual({ total: 0, generated: 0 });
  });
});

describe("ensureMockupForScreen", () => {
  it("no-op fuera de pantallas/", async () => {
    const r = await ensureMockupForScreen(cfg, "p", "reglas/RN-001.md", { force: false }, deps());
    expect(r.status).toBe("not-screen");
    expect(calls).toBe(0);
  });

  it("genera el sibling cuando hay spec real y no existe maqueta", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    const r = await ensureMockupForScreen(cfg, "p", "pantallas/login.md", { force: false }, deps());
    expect(r.status).toBe("generated");
    expect(r.path).toBe("pantallas/login.preview.html");
    expect(calls).toBe(1);
    const html = await fs.readFile(path.join(ws, "pantallas/login.preview.html"), "utf-8");
    expect(html).toContain(HTML);
    expect(html).toContain("spec-hash:"); // lleva la huella del cuerpo embebida
  });

  it("skip (auto) si la maqueta ya existe — no llama al LLM", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    await writeScreen("pantallas/login.preview.html", "<old/>");
    const r = await ensureMockupForScreen(cfg, "p", "pantallas/login.md", { force: false }, deps());
    expect(r.status).toBe("skipped");
    expect(calls).toBe(0);
    const html = await fs.readFile(path.join(ws, "pantallas/login.preview.html"), "utf-8");
    expect(html).toBe("<old/>"); // intacta
  });

  it("force regenera aunque exista", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    await writeScreen("pantallas/login.preview.html", "<old/>");
    const r = await ensureMockupForScreen(cfg, "p", "pantallas/login.md", { force: true }, deps());
    expect(r.status).toBe("generated");
    expect(calls).toBe(1);
    const html = await fs.readFile(path.join(ws, "pantallas/login.preview.html"), "utf-8");
    expect(html).toContain(HTML);
  });

  it("skip (auto) si el spec es un stub sin contenido", async () => {
    await writeScreen("pantallas/vacia.md", "# Pantalla vacía\n\n");
    const r = await ensureMockupForScreen(cfg, "p", "pantallas/vacia.md", { force: false }, deps());
    expect(r.status).toBe("skipped");
    expect(calls).toBe(0);
    await expect(fs.access(path.join(ws, "pantallas/vacia.preview.html"))).rejects.toThrow();
  });
});

describe("isMockupStale", () => {
  it("true cuando el CUERPO del spec cambió respecto a la huella de la maqueta", async () => {
    // maqueta generada para un cuerpo viejo (huella embebida de ese cuerpo)
    await writeScreen("pantallas/login.preview.html", `${HTML}\n<!-- spec-hash: ${specBodyHash("# Login\n\ncuerpo viejo")} -->\n`);
    await writeScreen("pantallas/login.md", "# Login\n\nCUERPO nuevo y distinto");
    expect(await isMockupStale(ws, "pantallas/login.md")).toBe(true);
  });

  it("false cuando la huella coincide con el cuerpo actual", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    await writeScreen("pantallas/login.preview.html", `${HTML}\n<!-- spec-hash: ${specBodyHash(SPEC)} -->\n`);
    expect(await isMockupStale(ws, "pantallas/login.md")).toBe(false);
  });

  it("false si la maqueta no lleva huella (antigua o write-back del builder)", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    await writeScreen("pantallas/login.preview.html", HTML); // sin spec-hash
    expect(await isMockupStale(ws, "pantallas/login.md")).toBe(false);
  });

  it("false si falta la maqueta", async () => {
    await writeScreen("pantallas/login.md", SPEC);
    expect(await isMockupStale(ws, "pantallas/login.md")).toBe(false);
  });
});
