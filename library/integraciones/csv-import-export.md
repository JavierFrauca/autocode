# CSV — importar y exportar con Fastify

**Categoría:** integraciones | **Cuándo usar:** Carga masiva de datos desde hoja de cálculo, exportación de informes o listados para el usuario.

## Dependencias

```
npm install csv-parse csv-stringify
```

## Importar CSV (subida → inserción en BD)

```typescript
// routes/importar-csv.ts
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";

export async function registerImportRoutes(app: FastifyInstance) {
  // El multipart ya debe estar registrado en server.ts (@fastify/multipart)
  app.post("/api/productos/importar-csv", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Sin fichero" });

    if (file.mimetype !== "text/csv" && !file.filename.endsWith(".csv")) {
      return reply.code(400).send({ error: "Solo se aceptan ficheros CSV" });
    }

    // Parsear el stream directamente — sin cargar todo en memoria
    const parser = parse({
      columns: true,        // primera fila = cabeceras
      skip_empty_lines: true,
      trim: true,
      cast: true,           // convierte números y booleanos automáticamente
    });

    const filas: any[] = [];

    for await (const fila of file.file.pipe(parser)) {
      // Validación fila a fila (lanza excepción para abortar)
      if (!fila.nombre || !fila.precio) {
        return reply.code(400).send({ error: `Fila inválida: ${JSON.stringify(fila)}` });
      }
      filas.push({
        id:     crypto.randomUUID(),
        nombre: String(fila.nombre),
        precio: Number(fila.precio),
      });
    }

    if (filas.length === 0) return reply.code(400).send({ error: "CSV vacío" });

    // Inserción en lote (Drizzle)
    await db().insert(schema.productos).values(filas).onConflictDoNothing();

    return { insertados: filas.length };
  });
}
```

## Exportar CSV (query → descarga)

```typescript
import { stringify } from "csv-stringify";
import { PassThrough } from "node:stream";

app.get("/api/productos/exportar-csv", async (req, reply) => {
  const productos = await db().select().from(schema.productos).orderBy(schema.productos.nombre);

  const stream = new PassThrough();

  // Cabeceras HTTP para forzar descarga en el navegador
  reply.raw.setHeader("Content-Type", "text/csv; charset=utf-8");
  reply.raw.setHeader("Content-Disposition", 'attachment; filename="productos.csv"');
  stream.pipe(reply.raw);

  const stringifier = stringify({ header: true, columns: ["nombre", "precio", "stock"] });
  stringifier.pipe(stream);

  for (const p of productos) {
    stringifier.write([p.nombre, p.precio, p.stock]);
  }
  stringifier.end();

  // Fastify no debe cerrar la respuesta — la gestiona el stream
  return reply;
});
```

## Cliente Vue — botón de importar

```vue
<script setup lang="ts">
import { ref } from "vue";

const cargando  = ref(false);
const resultado = ref<string | null>(null);
const error     = ref<string | null>(null);

async function importarCSV(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("file", file);

  cargando.value = true;
  error.value    = null;
  try {
    const r = await fetch("/api/productos/importar-csv", { method: "POST", body: form });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? r.statusText);
    resultado.value = `${data.insertados} productos importados`;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <label>
    <input type="file" accept=".csv,text/csv" @change="importarCSV" :disabled="cargando" />
    <span v-if="cargando">Importando…</span>
  </label>
  <p v-if="resultado" class="ok">{{ resultado }}</p>
  <p v-if="error"     class="error">{{ error }}</p>
</template>
```

## Cliente Vue — botón de exportar

```vue
<script setup lang="ts">
function exportarCSV() {
  // Abre la URL directamente; el navegador dispara la descarga
  window.location.href = "/api/productos/exportar-csv";
}
</script>

<template>
  <button @click="exportarCSV">Exportar CSV</button>
</template>
```

## Notas

- **Streaming**: `csv-parse` y `csv-stringify` trabajan como streams de Node.js — no cargan el fichero completo en memoria; válido para ficheros de varios MB.
- **Codificación**: añade `bom: true` en `stringify` si los usuarios van a abrir el CSV con Excel en Windows (BOM UTF-8 evita caracteres corruptos).
- **Validación**: para reglas complejas, usa Zod sobre cada fila antes de acumular; si hay error lanza antes de tocar la BD.
