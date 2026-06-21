import path from "node:path";

/**
 * Comprobaciones de contención de rutas robustas. El patrón `abs.startsWith(dir)` es
 * inseguro: "/a/library-evil".startsWith("/a/library") === true. Aquí usamos path.relative,
 * que no se deja engañar por prefijos de nombre ni por separadores.
 */

/** ¿`target` está estrictamente DENTRO de `parentDir` (no es el propio dir ni escapa con ..)? */
export function isInside(parentDir: string, target: string): boolean {
  const rel = path.relative(path.resolve(parentDir), path.resolve(target));
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** ¿`rel` es una ruta relativa segura (sin `..`, sin absoluta, no vacía)? */
export function isSafeRelative(rel: string): boolean {
  const norm = (rel ?? "").replace(/\\/g, "/").trim();
  if (!norm || norm.startsWith("/")) return false;
  if (path.isAbsolute(norm)) return false;
  // Cualquier segmento ".." escapa.
  return !norm.split("/").some((seg) => seg === "..");
}

/** Resuelve `rel` contra `baseDir` y devuelve la ruta absoluta solo si queda dentro; si no, null. */
export function safeResolve(baseDir: string, rel: string): string | null {
  if (!isSafeRelative(rel)) return null;
  const abs = path.resolve(baseDir, rel);
  return isInside(baseDir, abs) ? abs : null;
}
