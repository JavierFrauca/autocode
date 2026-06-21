# Cifrado en reposo — AES-256-GCM

**Categoría:** seguridad | **Cuándo usar:** Almacenar ficheros o datos sensibles (documentos privados, datos médicos, contratos) de forma que sean ilegibles si alguien accede al disco o a la BD.

## Conceptos clave

- **AES-256-GCM**: cifrado simétrico autenticado — garantiza confidencialidad E integridad (detecta si el fichero fue manipulado).
- **IV (nonce)**: vector de inicialización aleatorio, único por operación. Necesario para descifrar. No es secreto — se guarda junto al ciphertext.
- **Auth tag**: 16 bytes que GCM genera como firma del ciphertext. Se guarda junto al IV.
- **Clave maestra**: un secreto de 32 bytes derivado de la variable de entorno `ENCRYPTION_KEY`. Nunca se guarda en disco.

## Variables de entorno

```env
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=a3f1c...64 caracteres hex...
```

## Módulo de cifrado

```typescript
// security/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LEN    = 12;  // 96 bits — recomendado para GCM
const TAG_LEN   = 16;  // 128 bits

function masterKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("ENCRYPTION_KEY inválida (necesita 64 hex chars)");
  return Buffer.from(hex, "hex");
}

// Cifrar — devuelve un Buffer con [IV (12) | TAG (16) | ciphertext]
// Todo concatenado en un único buffer → fácil de guardar como columna BYTEA o fichero
export function encrypt(plaintext: Buffer): Buffer {
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag       = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]);
}

// Descifrar — espera el formato [IV | TAG | ciphertext]
export function decrypt(data: Buffer): Buffer {
  const iv         = data.subarray(0, IV_LEN);
  const tag        = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);

  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Versión string (para datos de texto cortos: notas, tokens, etc.)
export function encryptString(texto: string): string {
  return encrypt(Buffer.from(texto, "utf8")).toString("base64");
}

export function decryptString(base64: string): string {
  return decrypt(Buffer.from(base64, "base64")).toString("utf8");
}
```

## Integración con upload de ficheros

```typescript
// routes/documentos.ts — guardar fichero cifrado
import { encrypt, decrypt } from "../security/crypto.js";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { ulid } from "ulid";

const DOCS_DIR = path.join(process.env.DATA_DIR ?? "data", "docs");

app.post("/api/documentos", { preHandler: requireAuth }, async (req, reply) => {
  await mkdir(DOCS_DIR, { recursive: true });

  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "Sin fichero" });

  // Leer en memoria para cifrar (para ficheros muy grandes usar streams de cifrado)
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) chunks.push(chunk);
  const plaintext  = Buffer.concat(chunks);
  const cipherdata = encrypt(plaintext);

  const nombre    = ulid().toLowerCase();
  const rutaCiph  = path.join(DOCS_DIR, `${nombre}.enc`);

  await import("node:fs/promises").then(({ writeFile }) => writeFile(rutaCiph, cipherdata));

  // Guardar metadatos en BD (no el contenido)
  await db().insert(schema.documentos).values({
    id:           nombre,
    proyectoId:   req.user.userId,
    nombreOriginal: file.filename,
    mimeType:     file.mimetype,
    tamano:       plaintext.length,
    rutaFichero:  rutaCiph,
    creadoEn:     new Date().toISOString(),
    subidoPor:    req.user.userId,
  });

  return { id: nombre, nombre: file.filename };
});

// Descarga — descifrar al vuelo
app.get("/api/documentos/:id/descargar", { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };

  const rows = await db().select().from(schema.documentos).where(eq(schema.documentos.id, id));
  const doc  = rows[0];
  if (!doc) return reply.code(404).send({ error: "Documento no encontrado" });

  // TODO: verificar permisos (doc.proyectoId === req.user.userId o rol admin)

  const cipherdata = await readFile(doc.rutaFichero);
  const plaintext  = decrypt(cipherdata);

  reply.header("Content-Type",        doc.mimeType);
  reply.header("Content-Disposition", `attachment; filename="${doc.nombreOriginal}"`);
  reply.header("Content-Length",      plaintext.length);

  return reply.send(plaintext);
});
```

## Cifrado de campos en BD (datos sensibles cortos)

```typescript
// Para campos como DNI, número de teléfono, dirección, etc.
import { encryptString, decryptString } from "../security/crypto.js";

// Guardar
await db().insert(schema.pacientes).values({
  id,
  nombre:    paciente.nombre,           // no cifrado (necesario para buscar)
  dni:       encryptString(paciente.dni),    // cifrado
  telefono:  encryptString(paciente.telefono), // cifrado
});

// Leer
const row = rows[0];
return {
  ...row,
  dni:      decryptString(row.dni),
  telefono: decryptString(row.telefono),
};
```

## Rotación de clave (cambiar la clave maestra)

```typescript
// script: scripts/rotar-clave.ts
// 1. Configurar ENCRYPTION_KEY_OLD (vieja) y ENCRYPTION_KEY_NEW (nueva)
// 2. Leer cada fichero cifrado, descifrar con la vieja, cifrar con la nueva

import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

async function rotarClave() {
  const keyOld = Buffer.from(process.env.ENCRYPTION_KEY_OLD!, "hex");
  const keyNew = Buffer.from(process.env.ENCRYPTION_KEY_NEW!, "hex");

  const docs = await db().select().from(schema.documentos);
  for (const doc of docs) {
    const encrypted = await readFile(doc.rutaFichero);
    // descifrar con clave vieja
    const plain = decryptWithKey(encrypted, keyOld);
    // cifrar con clave nueva
    const newEncrypted = encryptWithKey(plain, keyNew);
    await writeFile(doc.rutaFichero, newEncrypted);
    console.log(`Rotado: ${doc.id}`);
  }
}
```

## Notas de seguridad

- **No reutilices el IV**: siempre `randomBytes(12)` por operación. Reutilizar el mismo IV con la misma clave rompe GCM.
- **Backup de la clave**: si pierdes `ENCRYPTION_KEY`, los datos son irrecuperables. Guárdala en un gestor de secretos (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, o simplemente un gestor de contraseñas seguro con backup).
- **Los metadatos no están cifrados**: nombre del fichero, tipo MIME, tamaño — están en claro en la BD. Si son sensibles, cífrralos también con `encryptString`.
- **Para ficheros muy grandes** (>50 MB): usa streams de cifrado en lugar de cargar en memoria. Node tiene `crypto.createCipheriv` como Transform stream.
