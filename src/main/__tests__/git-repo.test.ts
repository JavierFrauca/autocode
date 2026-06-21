import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { commitGreen, ensureRepo, gitAvailable, listVersions, restoreVersion } from "../git/repo.js";

/**
 * Prueba real de la máquina del tiempo: crea un proyecto temporal, lo versiona,
 * crea puntos de restauración y vuelve atrás, verificando el estado de los ficheros.
 */

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "autocode-git-"));
});
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

describe("git time-machine", () => {
  test("init + commits verdes + listar + revertir no destructivo", async () => {
    expect(await gitAvailable()).toBe(true);

    const proj = path.join(tmp, "proj");
    await fs.mkdir(proj, { recursive: true });

    // v1: estado inicial bueno
    await fs.writeFile(path.join(proj, "app.txt"), "version 1", "utf-8");
    await ensureRepo(proj);
    const h1 = await commitGreen(proj, "primera versión");
    expect(h1).toBeTruthy();

    // v2: un cambio
    await fs.writeFile(path.join(proj, "app.txt"), "version 2", "utf-8");
    await fs.writeFile(path.join(proj, "nuevo.txt"), "archivo nuevo", "utf-8");
    const h2 = await commitGreen(proj, "segunda versión");
    expect(h2).toBeTruthy();
    expect(h2).not.toBe(h1);

    // Sin cambios → no crea punto nuevo
    const h3 = await commitGreen(proj, "sin cambios");
    expect(h3).toBeNull();

    // Listado: 2 versiones verdes (+ commit inicial) en orden inverso
    const versions = await listVersions(proj);
    expect(versions.length).toBeGreaterThanOrEqual(3);
    expect(versions[0]?.subject).toContain("segunda versión");
    expect(versions[1]?.subject).toContain("primera versión");
    expect(versions[0]?.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Volver a v1: app.txt vuelve a "version 1" y nuevo.txt desaparece
    const r = await restoreVersion(proj, h1!);
    expect(r.ok).toBe(true);
    expect(await fs.readFile(path.join(proj, "app.txt"), "utf-8")).toBe("version 1");
    expect(existsSyncSafe(path.join(proj, "nuevo.txt"))).toBe(false);

    // NO destructivo: v2 sigue en el historial → se puede REHACER.
    const after = await listVersions(proj);
    expect(after.some((v) => v.subject.includes("segunda versión"))).toBe(true);

    // Rehacer: volver a v2 recupera el estado completo.
    const redo = await restoreVersion(proj, h2!);
    expect(redo.ok).toBe(true);
    expect(await fs.readFile(path.join(proj, "app.txt"), "utf-8")).toBe("version 2");
    expect(existsSyncSafe(path.join(proj, "nuevo.txt"))).toBe(true);
  }, 60_000);
});

function existsSyncSafe(p: string): boolean {
  try {
    require("node:fs").accessSync(p);
    return true;
  } catch {
    return false;
  }
}
