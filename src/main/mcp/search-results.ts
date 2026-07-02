/**
 * Parseo del resultado crudo de una tool MCP de búsqueda (convención: se llama `search`, y devuelve un
 * JSON con `{ results: [{ title, url, description }] }` — el formato real de `open-websearch`). Separado
 * de `routes/chat.ts` para poder testearlo sin servidor/BD.
 */
export interface SearchResultItem {
  titulo: string;
  url: string;
  descripcion: string;
}

/** Best-effort: si el texto no es JSON o no trae `results`, devuelve []  (el modelo igual ve el texto crudo). */
export function parseSearchResults(raw: string): SearchResultItem[] {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const sinEtiquetas = (s: string) => s.replace(/<\/?[a-z]+>/gi, "");
  const out: SearchResultItem[] = [];
  for (const r of results) {
    if (!r?.url) continue;
    out.push({
      titulo: sinEtiquetas(String(r.title ?? r.url)).slice(0, 200),
      url: String(r.url),
      descripcion: sinEtiquetas(String(r.description ?? "")).slice(0, 300),
    });
  }
  return out;
}
