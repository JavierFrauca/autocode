# Parseo de PDF — extraer texto con pdf-parse

**Categoría:** integraciones | **Cuándo usar:** Ingestión de documentos del usuario (contratos, facturas recibidas, informes), búsqueda en PDFs, extracción de datos para procesado posterior.

> Para **generar** PDFs, ver `pdf-generacion.md`. Este fichero cubre solo la extracción de texto de PDFs existentes.

## Dependencias

```
npm install pdf-parse
npm install -D @types/pdf-parse
```

## Extraer texto de un PDF subido

```typescript
// routes/parsear-pdf.ts
import pdfParse from "pdf-parse";
import type { FastifyInstance } from "fastify";

export async function registerPdfParseRoutes(app: FastifyInstance) {
  app.post("/api/documentos/parsear-pdf", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Sin fichero" });

    if (file.mimetype !== "application/pdf" && !file.filename.endsWith(".pdf")) {
      return reply.code(400).send({ error: "Solo se aceptan ficheros PDF" });
    }

    // Cargar el stream en buffer (pdf-parse no acepta streams directamente)
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Límite de tamaño
    const MB = 1024 * 1024;
    if (buffer.length > 20 * MB) {
      return reply.code(413).send({ error: "PDF demasiado grande (máx. 20 MB)" });
    }

    let resultado;
    try {
      resultado = await pdfParse(buffer, {
        max: 0,  // 0 = parsear todas las páginas (por defecto solo 0 páginas en el mock de test)
      });
    } catch (e: any) {
      return reply.code(422).send({ error: `PDF no legible: ${e.message}` });
    }

    return {
      paginas: resultado.numpages,
      texto:   resultado.text,
      info:    resultado.info,   // autor, título, fecha creación, etc.
    };
  });
}
```

## Extraer texto de un PDF en disco

```typescript
import pdfParse from "pdf-parse";
import { readFile } from "node:fs/promises";

async function extraerTextoPDF(rutaFichero: string): Promise<string> {
  const buffer    = await readFile(rutaFichero);
  const resultado = await pdfParse(buffer);
  return resultado.text;
}
```

## Guardar el texto en BD y en Qdrant para búsqueda semántica

```typescript
import pdfParse from "pdf-parse";
import { db, schema } from "../db/client.js";
import { embed } from "../llm/client.js";
import { qdrant } from "../qdrant/client.js";

async function indexarPDF(
  proyectoId: string,
  nombre: string,
  buffer: Buffer,
): Promise<void> {
  const resultado = await pdfParse(buffer);
  const texto     = resultado.text.trim();

  if (!texto) throw new Error("El PDF no contiene texto extraíble (puede ser escaneado)");

  // Guardar en BD
  const docId = crypto.randomUUID();
  await db().insert(schema.documentos).values({
    id:         docId,
    proyectoId,
    nombre,
    contenido:  texto,
    paginas:    resultado.numpages,
    creadoEn:   new Date().toISOString(),
  });

  // Dividir en fragmentos para vectorizar (chunks de ~500 palabras)
  const fragmentos = chunksDeTexto(texto, 500);
  const vectores   = await embed(config, fragmentos, "indexar");

  await qdrant.upsert("documentos", {
    points: fragmentos.map((frag, i) => ({
      id:      crypto.randomUUID(),
      vector:  vectores[i],
      payload: { proyectoId, docId, nombre, fragmento: i, texto: frag },
    })),
  });
}

function chunksDeTexto(texto: string, palabrasPorChunk: number): string[] {
  const palabras = texto.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < palabras.length; i += palabrasPorChunk) {
    chunks.push(palabras.slice(i, i + palabrasPorChunk).join(" "));
  }
  return chunks;
}
```

## Limitaciones conocidas

| Caso | Resultado | Alternativa |
|---|---|---|
| PDF escaneado (imagen) | Texto vacío | OCR con `tesseract.js` |
| PDF con DRM/contraseña | Error al parsear | Informar al usuario |
| PDF con tablas complejas | Texto mezclado sin estructura | Posprocesar con LLM para extraer la tabla |
| PDF muy grande (100+ pág) | Lento, alto uso de RAM | Procesar en background job, devolver jobId |

## PDF escaneado — OCR con Tesseract

```typescript
// Solo si pdf-parse devuelve texto vacío
import Tesseract from "tesseract.js";
import { fromBuffer } from "pdf2pic";  // necesita GraphicsMagick o ImageMagick instalado

async function extraerTextoOCR(buffer: Buffer): Promise<string> {
  // Convertir PDF a imágenes
  const convertidor = fromBuffer(buffer, { density: 200, format: "png" });
  const imagenes    = await convertidor.bulk(-1); // todas las páginas

  let textoTotal = "";
  for (const img of imagenes) {
    const { data } = await Tesseract.recognize(img.buffer!, "spa+eng");
    textoTotal += data.text + "\n";
  }
  return textoTotal;
}
```

> OCR requiere dependencias nativas (GraphicsMagick). Úsalo solo si el caso de uso lo exige; añade `pdf2pic`, `tesseract.js` y documenta el requisito de sistema.

## Notas

- `pdf-parse` extrae texto plano — no conserva formato, columnas ni tablas.
- El campo `resultado.info` contiene metadatos del PDF: `Title`, `Author`, `CreationDate`, `Producer`.
- Para PDFs muy largos, considera procesar en un worker (con `worker_threads`) para no bloquear el event loop de Fastify.
