import path from "node:path";
import { describe, expect, test } from "vitest";
import { isInside, isSafeRelative, safeResolve } from "../util/paths.js";

describe("contención de rutas", () => {
  test("isInside no se deja engañar por prefijos de nombre", () => {
    const base = path.resolve("/a/library");
    expect(isInside(base, path.resolve("/a/library/ddd/x.md"))).toBe(true);
    // El bug clásico: hermano con el mismo prefijo.
    expect(isInside(base, path.resolve("/a/library-evil/x.md"))).toBe(false);
    // Escapar con ..
    expect(isInside(base, path.resolve("/a/secret.md"))).toBe(false);
    // El propio dir no cuenta como "dentro".
    expect(isInside(base, base)).toBe(false);
  });

  test("isSafeRelative rechaza .. y absolutas", () => {
    expect(isSafeRelative("ddd/agregados.md")).toBe(true);
    expect(isSafeRelative("../etc/passwd")).toBe(false);
    expect(isSafeRelative("a/../../b")).toBe(false);
    expect(isSafeRelative("/abs/path")).toBe(false);
    expect(isSafeRelative("")).toBe(false);
  });

  test("safeResolve devuelve null si escapa", () => {
    const base = path.resolve("/work");
    expect(safeResolve(base, "src/a.ts")).toBe(path.resolve("/work/src/a.ts"));
    expect(safeResolve(base, "../escape.ts")).toBeNull();
    expect(safeResolve(base, "..\\..\\escape")).toBeNull();
  });
});
