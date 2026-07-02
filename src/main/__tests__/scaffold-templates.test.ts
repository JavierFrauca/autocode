import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Red de seguridad del ANDAMIAJE DORADO (el código real que `materializeScaffold` copia TAL CUAL a la
 * app generada: templates/{electron-app,server-app,api-server,mcp-server}/). A diferencia de
 * `library-templates.test.ts` (que valida fragmentos TS dentro de fichas .md de referencia), aquí los
 * ficheros SON el código que se copia — si uno tiene un error de sintaxis, la app generada nace rota.
 * Solo sintaxis (no type-check): no instalamos las dependencias de cada plantilla solo para testear esto.
 */
const ROOT = process.cwd();
const SCAFFOLDS = ["electron-app", "server-app", "api-server", "mcp-server"] as const;
const SKIP_DIRS = new Set(["node_modules", "out", "dist", "release"]);

async function walk(dir: string, exts: string[], rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), exts, r)));
    else if (exts.some((ext) => e.name.endsWith(ext))) out.push(r);
  }
  return out;
}

/** Errores PURAMENTE sintácticos (no type-check). */
function syntaxErrors(code: string, kind: ts.ScriptKind): string[] {
  const sf = ts.createSourceFile("snippet.ts", code, ts.ScriptTarget.Latest, false, kind);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

/** Extrae el contenido de `<script ...lang="ts"...>...</script>` de un SFC de Vue. */
function vueScriptBlock(sfc: string): string | null {
  const m = sfc.match(/<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

describe("andamiaje dorado — TypeScript sintácticamente válido (código real, no fragmentos de doc)", () => {
  for (const scaffold of SCAFFOLDS) {
    it(`templates/${scaffold}/: los .ts parsean sin errores de sintaxis`, async () => {
      const dir = path.join(ROOT, "templates", scaffold);
      const files = await walk(dir, [".ts"]);
      expect(files.length, `no se encontraron .ts en templates/${scaffold} (¿cwd correcto?)`).toBeGreaterThan(0);
      const problemas: string[] = [];
      for (const rel of files) {
        if (rel.endsWith(".d.ts")) continue; // solo declaraciones de tipos, no ejecutable
        const code = await fs.readFile(path.join(dir, rel), "utf-8");
        const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const errs = syntaxErrors(code, kind);
        if (errs.length) problemas.push(`${scaffold}/${rel}: ${errs[0]}`);
      }
      expect(problemas, `Ficheros con TypeScript mal formado:\n${problemas.join("\n")}`).toEqual([]);
    });

    it(`templates/${scaffold}/: los bloques <script lang="ts"> de los .vue parsean sin errores`, async () => {
      const dir = path.join(ROOT, "templates", scaffold);
      const files = await walk(dir, [".vue"]);
      const problemas: string[] = [];
      for (const rel of files) {
        const sfc = await fs.readFile(path.join(dir, rel), "utf-8");
        const script = vueScriptBlock(sfc);
        if (!script) continue;
        const errs = syntaxErrors(script, ts.ScriptKind.TS);
        if (errs.length) problemas.push(`${scaffold}/${rel}: ${errs[0]}`);
      }
      expect(problemas, `Vistas con TypeScript mal formado:\n${problemas.join("\n")}`).toEqual([]);
    });
  }

  it("cada plantilla trae un package.json JSON válido", async () => {
    for (const scaffold of SCAFFOLDS) {
      const raw = await fs.readFile(path.join(ROOT, "templates", scaffold, "package.json"), "utf-8");
      expect(() => JSON.parse(raw), `templates/${scaffold}/package.json no es JSON válido`).not.toThrow();
    }
  });
});
