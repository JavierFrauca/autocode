/**
 * Sube el número de versión PATCH (x.y.Z → x.y.Z+1) en package.json. Lo invoca el script `package`
 * ANTES de construir, para que cada instalador que generamos lleve una versión nueva: la usan tanto
 * electron-builder (nombre del .exe / metadatos) como la app, que la muestra en la barra superior
 * (Vite la inyecta como __APP_VERSION__ al construir). Sin dependencias y sin tocar git.
 *
 * Salta el incremento si se pasa --no-bump o AUTOCODE_NO_BUMP=1 (útil para reempaquetar sin subir versión).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");

if (process.argv.includes("--no-bump") || process.env.AUTOCODE_NO_BUMP === "1") {
  console.log("[bump-version] omitido (--no-bump)");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const m = String(pkg.version ?? "").match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
if (!m) {
  console.error(`[bump-version] versión no semántica: "${pkg.version}". No se toca package.json.`);
  process.exit(1);
}
const [, major, minor, patch, suffix] = m;
const next = `${major}.${minor}.${Number(patch) + 1}${suffix}`;
pkg.version = next;
// Conservamos el formato (2 espacios + salto final) para no ensuciar el diff de package.json.
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
console.log(`[bump-version] ${m[0]} → ${next}`);
