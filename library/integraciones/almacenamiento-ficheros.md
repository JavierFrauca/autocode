# Almacenamiento de ficheros (abstracción local / S3)

**Categoría:** integraciones | **Cuándo usar:** guardar adjuntos/imágenes/documentos. La SUBIDA (multipart,
validación, descarga) está en `library/integraciones/upload-ficheros.md`. Aquí va la **abstracción de
almacén** para que los handlers no dependan de DÓNDE se guarda: en local (disco) para empezar y "Probar",
en **S3** (u otro objeto) en producción, sin cambiar el código que lo usa.

## Puerto (interfaz)

```ts
// almacen/almacen.ts
export interface Almacen {
  guardar(clave: string, datos: Buffer): Promise<void>;
  leer(clave: string): Promise<Buffer>;
  borrar(clave: string): Promise<void>;
  url(clave: string): string; // URL pública/servible del recurso
}
```

## Implementación LOCAL (disco) — por defecto, sin dependencias extra

```ts
// almacen/almacen-local.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Almacen } from "./almacen.js";

const RAIZ = path.join(process.env.DATA_DIR ?? "data", "uploads");

export const almacenLocal: Almacen = {
  async guardar(clave, datos) {
    const dest = path.join(RAIZ, clave);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, datos);
  },
  async leer(clave) { return fs.readFile(path.join(RAIZ, clave)); },
  async borrar(clave) { await fs.rm(path.join(RAIZ, clave), { force: true }); },
  url(clave) { return `/api/ficheros/${clave}`; }, // servido con @fastify/static (ver upload-ficheros.md)
};
```

## Implementación S3 (producción) — sketch

```ts
// almacen/almacen-s3.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Almacen } from "./almacen.js";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET!;

export const almacenS3: Almacen = {
  async guardar(clave, datos) { await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: clave, Body: datos })); },
  async leer(clave) {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: clave }));
    return Buffer.from(await r.Body!.transformToByteArray());
  },
  async borrar(clave) { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: clave })); },
  url(clave) { return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${clave}`; },
};
```

```
npm install @aws-sdk/client-s3
```

## Selección por entorno

```ts
// almacen/index.ts — el resto del código importa SIEMPRE `almacen` (no la impl concreta)
import { almacenLocal } from "./almacen-local.js";
export const almacen = almacenLocal; // en producción: process.env.S3_BUCKET ? almacenS3 : almacenLocal
```

## Reglas

- **Clave, no nombre original**: genera la clave (p.ej. `${ulid()}${ext}`) y guarda el nombre original como
  metadato; nunca uses el nombre que sube el usuario como ruta (path traversal).
- **Valida tipo y tamaño** en la subida (ver upload-ficheros.md). Limita extensiones permitidas.
- **No metas binarios en SQLite/Postgres**: guarda el fichero en el almacén y solo la `clave`/URL en la BD.
- En local, el directorio de datos debe persistir (en el paquete de despliegue Docker, monta un volumen).

Relacionado: subida `library/integraciones/upload-ficheros.md`, despliegue (volumen) en el paquete Docker.
