import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Red de seguridad de la BIBLIOTECA y las PLANTILLAS doradas: el agente builder las copia (a veces
 * TAL CUAL). Si una plantilla tiene TypeScript roto o una ficha está malformada, el agente arrastra
 * el fallo a la app generada. Este test no necesita LLM ni Qdrant: solo lee los .md del disco.
 *
 * `process.cwd()` es la raíz del repo cuando se ejecuta `npm test` (vitest run src/main/__tests__).
 */
const ROOT = process.cwd();
const CATALOGS = ["library", "templates"] as const;

async function walkMd(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walkMd(path.join(dir, e.name), r)));
    else if (e.name.endsWith(".md")) out.push(r);
  }
  return out;
}

/** Extrae los bloques de código por lenguaje de fence (```lang … ```). */
function codeBlocks(md: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  let inFence = false;
  let lang = "";
  let buf: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^```(\S*)\s*$/);
    if (m) {
      if (!inFence) {
        inFence = true;
        lang = (m[1] ?? "").toLowerCase();
        buf = [];
      } else {
        blocks.push({ lang, code: buf.join("\n") });
        inFence = false;
        lang = "";
      }
      continue;
    }
    if (inFence) buf.push(line);
  }
  return blocks;
}

/** Errores PURAMENTE sintácticos de un fragmento TS (no type-check: las plantillas son fragmentos). */
function syntaxErrors(code: string): string[] {
  const sf = ts.createSourceFile("snippet.ts", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

describe("biblioteca y plantillas — buena formación", () => {
  for (const cat of CATALOGS) {
    it(`${cat}/: cada ficha empieza con título H1 y trae al menos un bloque de código`, async () => {
      const files = await walkMd(path.join(ROOT, cat));
      expect(files.length, `no se encontraron .md en ${cat}/ (¿cwd correcto?)`).toBeGreaterThan(0);
      for (const rel of files) {
        const md = await fs.readFile(path.join(ROOT, cat, rel), "utf-8");
        const firstNonEmpty = md.split(/\r?\n/).find((l) => l.trim());
        expect(firstNonEmpty ?? "", `${cat}/${rel} debe empezar con un título # H1`).toMatch(/^#\s+\S/);
        expect(md.includes("```"), `${cat}/${rel} debe incluir al menos un bloque de código`).toBe(true);
      }
    });
  }
});

describe("biblioteca y plantillas — TypeScript sintácticamente válido", () => {
  for (const cat of CATALOGS) {
    it(`${cat}/: los bloques ts/typescript/tsx parsean sin errores de sintaxis`, async () => {
      const files = await walkMd(path.join(ROOT, cat));
      const problemas: string[] = [];
      for (const rel of files) {
        const md = await fs.readFile(path.join(ROOT, cat, rel), "utf-8");
        for (const b of codeBlocks(md)) {
          if (!["ts", "typescript", "tsx"].includes(b.lang)) continue;
          // Solo verificamos bloques "de módulo" (con import/export): son los que el agente deja
          // caer como ficheros. Los fragmentos didácticos (un método suelto, ejemplos con `...`,
          // respuestas JSON ilustrativas) no son código copiable y se omiten a propósito.
          if (!/(^|\n)\s*(import|export)\b/.test(b.code)) continue;
          // Sustituye los placeholders documentados del template ({Entidad}, {tabla}…) por un
          // identificador válido, para verificar la SINTAXIS real del andamiaje, no la convención.
          const code = b.code.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, "$1");
          const errs = syntaxErrors(code);
          if (errs.length) problemas.push(`${cat}/${rel}: ${errs[0]}`);
        }
      }
      expect(problemas, `Fichas con TypeScript mal formado:\n${problemas.join("\n")}`).toEqual([]);
    });
  }
});
