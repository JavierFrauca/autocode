import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runVitest } from "../agents/qa-exec.js";

/**
 * Verificación del sandbox Docker (🔴2). Integra DE VERDAD con el motor Docker:
 * instala dependencias en el contenedor (fase 1, con red) y ejecuta los tests
 * SIN red (fase 2). Gateado por env para no ralentizar la suite normal ni romper
 * en máquinas sin Docker. Ejecutar con:  AUTOCODE_TEST_DOCKER=1 vitest run ...docker
 */
const enabled = process.env.AUTOCODE_TEST_DOCKER === "1";

describe.runIf(enabled)("sandbox Docker", () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "autocode-docker-"));
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  test("instala dependencias y ejecuta los tests aislados en contenedor", async () => {
    const ws = path.join(tmp, "dep-app");
    await fs.mkdir(path.join(ws, "tests"), { recursive: true });

    // App que DECLARA una dependencia de ejecución (el host la rechazaría; Docker la instala).
    await fs.writeFile(
      path.join(ws, "package.json"),
      JSON.stringify(
        { name: "dep-app", type: "module", dependencies: { "is-odd": "3.0.1" }, devDependencies: { vitest: "^2.1.5" } },
        null, 2,
      ),
      "utf-8",
    );
    await fs.writeFile(
      path.join(ws, "tests", "spec.test.ts"),
      `import { test, expect } from "vitest";
import isOdd from "is-odd";
test("usa la dependencia instalada en el contenedor", () => {
  expect(isOdd(3)).toBe(true);
  expect(isOdd(4)).toBe(false);
});`,
      "utf-8",
    );

    const r = await runVitest(ws, { sandbox: "docker", timeoutMs: 300_000 });
    expect(r.sandbox).toBe("docker");
    expect(r.ran).toBe(true);
    expect(r.success).toBe(true);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
  }, 360_000);
});
