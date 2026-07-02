# IA — búsqueda semántica propia (chunking + embeddings + SQLite)

**Categoría:** integraciones | **Cuándo usar:** la app necesita "buscar por significado" sobre SUS
PROPIOS documentos (manuales internos, histórico de tickets, cláusulas de contratos, base de
conocimiento…) — no una búsqueda de texto exacto (para eso, `library/ui/busqueda-filtrado.md` es
suficiente y más barato).

**Por qué así y no con una base de datos vectorial aparte**: para el tamaño típico de una app interna/de
negocio (cientos a pocos miles de fragmentos), no hace falta infraestructura extra (Qdrant, Pinecone,
Docker…) — SQLite (que la app YA trae) más un poco de JS bastan. Es el mismo principio que el resto del
andamiaje: cero infraestructura pesada por defecto. Si más adelante un dominio concreto crece mucho
(decenas de miles de fragmentos +) y la búsqueda empieza a notarse lenta, revisa si ha aparecido una
extensión de SQLite para vectores con buen soporte multiplataforma (comprébalo en ese momento — el
ecosistema cambia) antes de montar infraestructura nueva.

## Piezas

1. **Chunking**: trocea cada documento por encabezados Markdown (con solape en los trozos largos) — el
   mismo criterio simple que usa el propio AutoCode para indexar sus papers.
2. **Embeddings**: se generan con el MISMO proveedor que el chat (`library/integraciones/ia-llm.md`),
   llamando a `/v1/embeddings` en vez de `/v1/chat/completions`.
3. **Almacenamiento**: cada fragmento + su vector (empaquetado como BLOB) en una tabla SQLite.
4. **Búsqueda**: fuerza bruta en memoria (similitud coseno) — sin índice ni extensión nativa.

```typescript
// services/embeddings.ts
import { getDb } from "../db.js"; // el mismo better-sqlite3 que ya usa la app

export interface Chunk { text: string; headingPath: string | null }

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

/** Trocea un texto por encabezados Markdown, con solape en los trozos largos. Sin dependencias. */
export function chunkText(body: string): Chunk[] {
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; text: string } = { heading: null, text: "" };
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (current.text.trim()) sections.push(current);
      current = { heading: m[2]?.trim() ?? null, text: "" };
    } else {
      current.text += line + "\n";
    }
  }
  if (current.text.trim()) sections.push(current);

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const t = s.text.trim();
    if (!t) continue;
    if (t.length <= CHUNK_SIZE) { chunks.push({ text: t, headingPath: s.heading }); continue; }
    let i = 0;
    while (i < t.length) {
      chunks.push({ text: t.slice(i, i + CHUNK_SIZE), headingPath: s.heading });
      i += CHUNK_SIZE - CHUNK_OVERLAP;
    }
  }
  return chunks;
}

/** Embeddings de varios textos en una sola llamada (más barato que uno a uno). */
async function embed(textos: string[]): Promise<number[][]> {
  const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  if (!apiKey) throw new Error("Falta LLM_API_KEY.");

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: textos }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`El servicio de embeddings respondió con error ${res.status}`);
  const data = await res.json();
  return (data?.data ?? []).map((d: any) => d.embedding as number[]);
}

function empaquetar(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}
function desempaquetar(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}
function coseno(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Indexa (o REINDEXA) un documento: borra sus fragmentos anteriores y mete los nuevos. Idempotente. */
export async function indexarDocumento(documento: string, textoCompleto: string): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM fragmentos WHERE documento = ?").run(documento);
  const trozos = chunkText(textoCompleto);
  if (!trozos.length) return;

  const vectores = await embed(trozos.map((t) => t.text));
  const insertar = db.prepare(
    "INSERT INTO fragmentos (documento, heading, texto, embedding) VALUES (?, ?, ?, ?)",
  );
  const transaccion = db.transaction((filas: typeof trozos) => {
    filas.forEach((t, i) => insertar.run(documento, t.headingPath, t.text, empaquetar(vectores[i])));
  });
  transaccion(trozos);
}

export interface ResultadoBusqueda { documento: string; heading: string | null; texto: string; puntuacion: number }

/** Busca los `k` fragmentos más parecidos por significado a la consulta (fuerza bruta en memoria). */
export async function buscar(consulta: string, k = 5): Promise<ResultadoBusqueda[]> {
  const [vectorConsulta] = await embed([consulta]);
  const consultaF32 = new Float32Array(vectorConsulta);

  const filas = getDb().prepare("SELECT documento, heading, texto, embedding FROM fragmentos").all() as
    { documento: string; heading: string | null; texto: string; embedding: Buffer }[];

  return filas
    .map((f) => ({
      documento: f.documento, heading: f.heading, texto: f.texto,
      puntuacion: coseno(consultaF32, desempaquetar(f.embedding)),
    }))
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, k);
}
```

## Tabla SQLite (añadir a `db.ts`, junto a las demás)

```typescript
db.exec(
  `CREATE TABLE IF NOT EXISTS fragmentos (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     documento  TEXT NOT NULL,
     heading    TEXT,
     texto      TEXT NOT NULL,
     embedding  BLOB NOT NULL
   )`,
);
db.exec("CREATE INDEX IF NOT EXISTS idx_fragmentos_documento ON fragmentos (documento)");
```

## Uso

```typescript
// Al guardar/actualizar un documento (manual, ticket, contrato…):
await indexarDocumento(`manual/${manual.id}`, manual.contenido);

// Al buscar (p.ej. desde un endpoint de "preguntar a la base de conocimiento"):
const resultados = await buscar("cómo se calcula la penalización por retraso", 5);
// resultados[0].texto es el fragmento más parecido; úsalo como CONTEXTO para chatCompletion
// (ver library/integraciones/ia-llm.md) en vez de responder de memoria — así el asistente
// contesta con lo que la app REALMENTE tiene documentado.
```

## Reglas

- **Reindexa borrando primero** (`DELETE ... WHERE documento = ?`): evita fragmentos huérfanos de
  versiones antiguas del mismo documento.
- **Un embedding por fragmento, no por documento entero**: los documentos largos pierden precisión si se
  embeben de una vez; por eso se trocea primero.
- **Techo realista de la fuerza bruta**: hasta unos pocos miles de fragmentos, la búsqueda tarda
  milisegundos. Si un dominio concreto crece mucho (decenas de miles+), considera filtrar antes por
  categoría/fecha (reduce cuántos vectores hay que comparar) antes de añadir infraestructura nueva.
- **Coste**: los modelos de embeddings son mucho más baratos por token que los de chat — está bien
  indexar documentos grandes, pero sigue troceando (no mandes el documento entero como un solo texto).
- La clave (`LLM_API_KEY`) nunca sale del backend, igual que en `ia-llm.md`.

Relacionado: `library/integraciones/ia-llm.md` (mismo proveedor, para generar la respuesta final),
`library/arquitectura/repository.md` (este servicio podría envolverse en un repositorio igual, si el
dominio lo pide), `library/persistencia/sqlite-crud.md`.
