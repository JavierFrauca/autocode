/**
 * Lógica PURA de los documentos técnicos: rutas, slug y composición del paper. Aislada de la BD y de
 * los módulos nativos (igual que `attachments-extract.ts`) para poder testearla bajo vitest/node sin
 * arrastrar `better-sqlite3`. El guardado en disco/BD/índice y el destilado con el LLM viven en
 * `attachments.ts` (`saveTechnicalDoc` / `buildTechnicalPaper`).
 */

export const TECH_DIR = "tecnicos";
export const TECH_PREFIX = "DT";
/** Tope de caracteres de fuente que pasamos al modelo destilador (un esquema enorme se trunca). */
export const TECH_RAW_CAP = 48_000;

/** Normaliza un nombre a slug de fichero (sin acentos, kebab, recortado). */
function slugify(s: string): string {
  return (
    s.normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "doc"
  );
}

/** Rutas (paper + fuente cruda) y título de un documento técnico. Puro y testeable. */
export function technicalDocPaths(
  numberPadded: string,
  name: string,
): { docPath: string; sourcePath: string; title: string } {
  const base = `${TECH_DIR}/${TECH_PREFIX}-${numberPadded}-${slugify(name)}`;
  return {
    docPath: `${base}.md`,
    sourcePath: `${base}.fuente.md`,
    title: `DT-${numberPadded}: ${name}`.slice(0, 180),
  };
}

/**
 * Compone el paper técnico final: frontmatter de procedencia + cuerpo del modelo + sección «Fuente»
 * garantizada por código (la trazabilidad no depende de que el modelo se acuerde). Puro y testeable.
 */
export function composeTechnicalPaper(opts: {
  title: string;
  paperBody: string;
  source: string;
  fechaISO: string;
}): string {
  const front = [
    "---",
    "tipo: documento técnico (fuente canónica aportada)",
    `origen: ${opts.source}`,
    `fecha: ${opts.fechaISO}`,
    "---",
    "",
  ].join("\n");
  const trimmed = opts.paperBody.trim();
  const body = trimmed.startsWith("#") ? trimmed : `# ${opts.title}\n\n${trimmed}`;
  const fuente = `\n\n## Fuente\n\n- Origen: ${opts.source}\n- Registrado el ${opts.fechaISO}\n`;
  return `${front}${body}${fuente}`;
}
