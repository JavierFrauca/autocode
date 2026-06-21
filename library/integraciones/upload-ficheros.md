# Upload de ficheros con Fastify Multipart

**Categoría:** integraciones | **Cuándo usar:** Subida de imágenes, documentos PDF, CSVs u otros binarios desde el frontend.

## Setup

```typescript
import fastifyMultipart from "@fastify/multipart";

await app.register(fastifyMultipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,   // 10 MB máximo
    files:    5,                    // máximo 5 ficheros por petición
  },
});
```

## Ruta de subida — guardar en disco

```typescript
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ulid } from "ulid";

const UPLOADS_DIR = path.join(process.env.DATA_DIR ?? "data", "uploads");

app.post("/api/ficheros", async (req, reply) => {
  await mkdir(UPLOADS_DIR, { recursive: true });

  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "Sin fichero" });

  // Validar tipo
  const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!TIPOS_PERMITIDOS.includes(file.mimetype)) {
    return reply.code(400).send({ error: "Tipo de fichero no permitido" });
  }

  const ext      = path.extname(file.filename) || ".bin";
  const nombre   = `${ulid().toLowerCase()}${ext}`;
  const rutaFull = path.join(UPLOADS_DIR, nombre);

  await pipeline(file.file, createWriteStream(rutaFull));

  // Si el stream fue abortado (fichero muy grande)
  if (file.file.truncated) {
    return reply.code(413).send({ error: "Fichero demasiado grande" });
  }

  return { nombre, url: `/api/ficheros/${nombre}` };
});
```

## Ruta de descarga

```typescript
import fastifyStatic from "@fastify/static";

await app.register(fastifyStatic, {
  root: UPLOADS_DIR,
  prefix: "/api/ficheros/",
});
```

## Subida múltiple

```typescript
app.post("/api/ficheros/lote", async (req, reply) => {
  const parts = req.files();
  const resultados = [];

  for await (const file of parts) {
    const nombre = `${ulid().toLowerCase()}${path.extname(file.filename)}`;
    await pipeline(file.file, createWriteStream(path.join(UPLOADS_DIR, nombre)));
    resultados.push({ original: file.filename, nombre, url: `/api/ficheros/${nombre}` });
  }

  return { ficheros: resultados };
});
```

## Cliente Vue — input de fichero

```vue
<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api.js";

const subiendo  = ref(false);
const progreso  = ref(0);
const url       = ref<string | null>(null);

async function handleFichero(e: Event) {
  const input = e.target as HTMLInputElement;
  const file  = input.files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("file", file);

  subiendo.value = true;
  try {
    const res = await api.post("/api/ficheros", form, {
      onUploadProgress: (p) => {
        progreso.value = Math.round((p.loaded / (p.total ?? 1)) * 100);
      },
    });
    url.value = res.data.url;
  } finally {
    subiendo.value = false;
    progreso.value = 0;
  }
}
</script>

<template>
  <input type="file" accept="image/*,.pdf" @change="handleFichero" :disabled="subiendo" />
  <progress v-if="subiendo" :value="progreso" max="100" />
  <img v-if="url" :src="url" />
</template>
```

## Dependencias

```
npm install @fastify/multipart @fastify/static
```
