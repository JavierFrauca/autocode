import { beforeEach, describe, expect, it } from "vitest";
import { initDb } from "../src/main/db.js";
import { ItemsRepoSqlite } from "../src/main/repos/items.repo.js";

/**
 * Test del REPOSITORIO (lo que de verdad ejecuta cada handler IPC — ver `src/main/index.ts`, que solo
 * delega en `repos.items`). `initDb` recibe ":memory:" para no tocar disco ni depender de un proceso
 * Electron real (no llama a `app.getPath` aquí — eso lo hace `index.ts`).
 */
describe("ItemsRepoSqlite", () => {
  let repo: ItemsRepoSqlite;

  beforeEach(() => {
    initDb(":memory:");
    repo = new ItemsRepoSqlite();
  });

  it("empieza vacío", () => {
    expect(repo.listar()).toEqual([]);
  });

  it("crear añade el item y aparece en listar", () => {
    const creado = repo.crear("primero");
    expect(creado.nombre).toBe("primero");
    expect(repo.listar()).toHaveLength(1);
  });

  it("listar devuelve los más recientes primero", () => {
    repo.crear("uno");
    repo.crear("dos");
    const [primero, segundo] = repo.listar();
    expect(primero.nombre).toBe("dos");
    expect(segundo.nombre).toBe("uno");
  });

  it("borrar quita el item", () => {
    const item = repo.crear("a borrar");
    repo.borrar(item.id);
    expect(repo.listar()).toEqual([]);
  });
});
