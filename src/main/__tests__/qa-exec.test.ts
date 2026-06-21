import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runVitest } from "../agents/qa-exec.js";

/**
 * Prueba el arnés de ejecución real: genera workspaces temporales con tests
 * conocidos y verifica que runVitest los corre y parsea el veredicto bien.
 * Esto demuestra el "crear tests de ejemplo y pasarlos" a nivel de mecanismo,
 * sin depender de un LLM.
 */

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autocode-qa-"));
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

async function makeWorkspace(name: string, testContent: string): Promise<string> {
  const dir = path.join(tmpRoot, name);
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });
  await fs.writeFile(path.join(dir, "tests", "spec.test.ts"), testContent, "utf-8");
  return dir;
}

describe("runVitest", () => {
  test("workspace todo verde => success con conteos correctos", async () => {
    const ws = await makeWorkspace(
      "all-green",
      `import { test, expect } from "vitest";
test("uno mas uno", () => { expect(1 + 1).toBe(2); });
test("cadena", () => { expect("ab".length).toBe(2); });
`,
    );
    const r = await runVitest(ws, { timeoutMs: 60_000, sandbox: "host" });
    expect(r.ran).toBe(true);
    expect(r.success).toBe(true);
    expect(r.total).toBe(2);
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.sandbox).toBe("host");
  }, 90_000);

  test("workspace con un fallo => success=false y el fallo se reporta", async () => {
    const ws = await makeWorkspace(
      "one-red",
      `import { test, expect } from "vitest";
test("pasa", () => { expect(2 + 2).toBe(4); });
test("falla a proposito", () => { expect(2 - 1).toBe(5); });
`,
    );
    const r = await runVitest(ws, { timeoutMs: 60_000, sandbox: "host" });
    expect(r.ran).toBe(true);
    expect(r.success).toBe(false);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    const failing = r.tests.find((t) => t.status === "failed");
    expect(failing).toBeTruthy();
    expect(failing?.name).toContain("falla a proposito");
  }, 90_000);

  test("app con dependencias SIN node_modules + host => INCONCLUSO (no bloquea), no instala nada", async () => {
    const ws = path.join(tmpRoot, "needs-deps");
    await fs.mkdir(path.join(ws, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "package.json"),
      JSON.stringify({ name: "x", type: "module", dependencies: { "some-lib": "^1.0.0" } }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(ws, "tests", "spec.test.ts"),
      `import { test, expect } from "vitest"; test("x", () => { expect(1).toBe(1); });`,
      "utf-8",
    );
    // En monopuesto los node_modules viven en el host (ensureAppDeps). Si aún no están instalados, los
    // tests quedan inconclusos (ran:false) sin bloquear el verde — no se instala nada por sorpresa.
    const r = await runVitest(ws, { sandbox: "host" });
    expect(r.ran).toBe(false);
    expect(r.sandbox).toBe("host");
    expect(r.error).toMatch(/node_modules/i);
  }, 30_000);
});
