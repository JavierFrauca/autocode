import matter from "gray-matter";

/**
 * Jerarquía de pantallas guardada como FRONTMATTER en el propio spec (`pantallas/<slug>.md`):
 *   ---
 *   tipo: pagina | modal
 *   padre: <slug del padre>     # solo si es modal/anidada
 *   orden: 0
 *   ---
 * El spec sigue siendo la única fuente de verdad; el árbol (cascada de modales) se DERIVA de aquí.
 * El `slug` de una pantalla es el nombre de su fichero sin `.md` (p.ej. `pantallas/nuevo-paciente.md`
 * → slug `nuevo-paciente`); un modal referencia a su página con `padre: <slug>`.
 */

export type ScreenKind = "pagina" | "modal";

export interface ScreenMeta {
  kind: ScreenKind;
  parent: string | null;
  order: number;
}

/** Slug estable de una pantalla a partir de su ruta (`pantallas/x.md` → `x`). */
export function screenSlug(relPath: string): string {
  const base = relPath.replace(/\\/g, "/").split("/").pop() ?? relPath;
  return base.replace(/\.md$/i, "");
}

/** Lee la jerarquía del frontmatter del spec (tolerante: por defecto página suelta). */
export function readScreenMeta(specContent: string): ScreenMeta {
  try {
    const data = (matter(specContent).data ?? {}) as Record<string, unknown>;
    const kind: ScreenKind = data.tipo === "modal" ? "modal" : "pagina";
    const padre = typeof data.padre === "string" && data.padre.trim() ? data.padre.trim() : null;
    const orden = typeof data.orden === "number" && Number.isFinite(data.orden) ? data.orden : 0;
    return { kind, parent: padre, order: orden };
  } catch {
    return { kind: "pagina", parent: null, order: 0 };
  }
}

/** Devuelve el spec con el frontmatter actualizado (sin tocar el cuerpo). */
export function writeScreenMeta(specContent: string, meta: Partial<ScreenMeta>): string {
  const parsed = matter(specContent);
  const data: Record<string, unknown> = { ...parsed.data };
  if (meta.kind !== undefined) data.tipo = meta.kind;
  if (meta.parent !== undefined) {
    if (meta.parent) data.padre = meta.parent;
    else delete data.padre;
  }
  if (meta.order !== undefined) data.orden = meta.order;
  return matter.stringify(parsed.content, data);
}

/** Crea el contenido inicial de una pantalla nueva (frontmatter + título). */
export function newScreenContent(name: string, meta: ScreenMeta): string {
  const data: Record<string, unknown> = { tipo: meta.kind, orden: meta.order };
  if (meta.parent) data.padre = meta.parent;
  return matter.stringify(`# ${name}\n\n`, data);
}

/** Garantiza que un spec de pantalla lleva frontmatter (al menos `tipo`); preserva el cuerpo. Lo aplica
 *  el escritor de bajo nivel para que NINGÚN camino deje una pantalla sin jerarquía. */
export function ensureScreenFrontmatter(content: string): string {
  const data = (matter(content).data ?? {}) as Record<string, unknown>;
  if (data.tipo) return content;
  return writeScreenMeta(content, { kind: data.tipo === "modal" ? "modal" : "pagina" });
}

/** ¿La ruta relativa es un spec de pantalla (`pantallas/<x>.md`)? Los ficheros `_*` (p.ej. `_mapa.md`)
 *  NO son pantallas: son artefactos internos del apartado. */
export function isScreenSpecPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p.startsWith("pantallas/") || !p.toLowerCase().endsWith(".md")) return false;
  const base = p.split("/").pop() ?? "";
  return !base.startsWith("_") && !base.toLowerCase().endsWith(".fuente.md");
}
