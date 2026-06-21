/**
 * Extrae un objeto JSON de la respuesta de un LLM, tolerando:
 *  - Texto introductorio o final del modelo
 *  - Bloques fenced markdown (```json ... ```)
 *  - Comentarios JSON estilo // o /* *\/
 *  - Comas finales en arrays/objetos
 *
 * Intenta varias estrategias por orden de probabilidad.
 */
export function extractJson<T = any>(raw: string): T {
  const text = (raw ?? "").trim();
  if (!text) throw new Error("respuesta vacía");

  // 1) Parse directo
  try {
    return JSON.parse(text);
  } catch {}

  // 2) Bloque fenced ```json ... ``` o ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
    try {
      return JSON.parse(cleanup(fenced[1]));
    } catch {}
  }

  // 3) Primer objeto/array balanceado en el texto
  const slice = balancedSlice(text);
  if (slice) {
    try {
      return JSON.parse(slice);
    } catch {}
    try {
      return JSON.parse(cleanup(slice));
    } catch {}
  }

  // 4) Cleanup global y reintento
  try {
    return JSON.parse(cleanup(text));
  } catch {}

  throw new Error("respuesta no parseable como JSON");
}

/** Quita comentarios y comas finales — los modelos los meten muy a menudo. */
function cleanup(s: string): string {
  let out = s;
  // bloque /* ... */
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  // línea //
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  // comas finales antes de ] o }
  out = out.replace(/,\s*([}\]])/g, "$1");
  return out;
}

/** Busca el primer { ... } o [ ... ] con paréntesis balanceados. */
function balancedSlice(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "{" && c !== "[") continue;
    const close = c === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === c) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return s.slice(i, j + 1);
      }
    }
  }
  return null;
}
