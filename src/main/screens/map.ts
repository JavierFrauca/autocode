/**
 * El MAPA de pantallas (`pantallas/_mapa.md`) es la **fuente única de la ESTRUCTURA**: el árbol de
 * pantallas de la app y cómo se relacionan (páginas con sus modales anidados, en orden). Es una lista
 * anidada en Markdown — legible por una persona y parseable. El `tipo`/`padre`/`orden` del frontmatter
 * de cada pantalla es un SELLO derivado que se estampa al materializar desde el mapa; nunca al revés.
 */

export const MAP_REL = "pantallas/_mapa.md";

export interface MapNode {
  slug: string;
  name: string;
  kind: "pagina" | "modal";
  children: MapNode[];
}

export interface FlatMapEntry {
  slug: string;
  name: string;
  kind: "pagina" | "modal";
  parent: string | null;
  order: number;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Parsea la lista anidada del mapa en un árbol. La sangría (2 espacios = un nivel) marca la jerarquía;
 *  raíz = página, anidado = modal de su ancestro (salvo marcador `(modal)`/`(página)` explícito). */
export function parseMap(md: string): MapNode[] {
  const roots: MapNode[] = [];
  const stack: { depth: number; node: MapNode }[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const m = raw.match(/^(\s*)[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    const indent = (m[1] ?? "").replace(/\t/g, "  ").length;
    const depth = Math.floor(indent / 2);
    let name = (m[2] ?? "").trim();
    let kind: "pagina" | "modal" | null = null;
    const marker = name.match(/\((modal|p[áa]gina)\)\s*$/i);
    if (marker) {
      kind = /modal/i.test(marker[1]!) ? "modal" : "pagina";
      name = name.slice(0, marker.index).trim();
    }
    if (!name) continue;
    const node: MapNode = { slug: slugify(name), name, kind: kind ?? (depth === 0 ? "pagina" : "modal"), children: [] };
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.node.children.push(node);
    stack.push({ depth, node });
  }
  return roots;
}

/** Serializa el árbol a la lista anidada Markdown del mapa. */
export function serializeMap(nodes: MapNode[]): string {
  const out: string[] = [
    "# Mapa de pantallas",
    "",
    "<!-- Árbol de pantallas de la app: fuente de la ESTRUCTURA. Se edita en la sección «Pantallas». -->",
    "",
  ];
  const walk = (ns: MapNode[], depth: number): void => {
    for (const n of ns) {
      const marker = depth === 0 && n.kind === "modal" ? " (modal)" : "";
      out.push(`${"  ".repeat(depth)}- ${n.name}${marker}`);
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out.join("\n") + "\n";
}

/** Aplana el árbol a entradas con padre y orden (para estampar el frontmatter al materializar). */
export function flattenMap(nodes: MapNode[]): FlatMapEntry[] {
  const out: FlatMapEntry[] = [];
  let order = 0;
  const walk = (ns: MapNode[], parent: string | null): void => {
    for (const n of ns) {
      order += 10;
      out.push({ slug: n.slug, name: n.name, kind: n.kind, parent, order });
      if (n.children?.length) walk(n.children, n.slug);
    }
  };
  walk(nodes, null);
  return out;
}

/** Construye el árbol del mapa a partir de pantallas existentes (migración / generación). */
export function buildMapFromScreens(
  screens: { slug: string; name: string; kind: "pagina" | "modal"; parent: string | null; order: number }[],
): MapNode[] {
  const bySlug = new Map<string, MapNode>(
    screens.map((s) => [s.slug, { slug: s.slug, name: s.name, kind: s.kind, children: [] as MapNode[] }]),
  );
  const roots: MapNode[] = [];
  for (const s of [...screens].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
    const node = bySlug.get(s.slug)!;
    const parent = s.parent ? bySlug.get(s.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
