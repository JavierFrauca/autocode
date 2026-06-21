# Template: Importar y exportar CSV

Sustituye `{Entidad}`, `{entidad}`, `{entidades}`, `{tabla}` por el nombre real.

## Ruta importar + exportar CSV

```typescript
// src/routes/{entidades}-csv.ts
import { parse }     from "csv-parse";
import { stringify } from "csv-stringify";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";

// Columnas del CSV — ajusta según el esquema real
const COLUMNAS_EXPORT = ["nombre", "precio", "stock", "creadoEn"] as const;

export async function register{Entidad}CsvRoutes(app: FastifyInstance) {

  // ─── IMPORTAR ──────────────────────────────────────────────────────────────
  app.post("/api/{entidades}/importar-csv", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Sin fichero" });

    if (!file.filename.endsWith(".csv") && file.mimetype !== "text/csv") {
      return reply.code(400).send({ error: "Solo se aceptan ficheros CSV" });
    }

    const parser = parse({
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
      cast:              true,
    });

    const filas: (typeof schema.{tabla}.$inferInsert)[] = [];

    try {
      for await (const fila of file.file.pipe(parser)) {
        // TODO: ajusta los campos obligatorios
        if (!fila.nombre) {
          return reply.code(400).send({ error: `Fila sin nombre: ${JSON.stringify(fila)}` });
        }
        filas.push({
          id:       crypto.randomUUID(),
          nombre:   String(fila.nombre),
          // ... resto de campos
          creadoEn: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      return reply.code(422).send({ error: `CSV malformado: ${e.message}` });
    }

    if (filas.length === 0) return reply.code(400).send({ error: "CSV vacío" });

    await db().insert(schema.{tabla}).values(filas).onConflictDoNothing();

    return { insertados: filas.length };
  });

  // ─── EXPORTAR ──────────────────────────────────────────────────────────────
  app.get("/api/{entidades}/exportar-csv", async (_req, reply) => {
    const registros = await db().select().from(schema.{tabla});

    const stream = new PassThrough();
    reply.raw.setHeader("Content-Type",        "text/csv; charset=utf-8");
    reply.raw.setHeader("Content-Disposition", `attachment; filename="{entidades}.csv"`);
    stream.pipe(reply.raw);

    const stringifier = stringify({ header: true, columns: [...COLUMNAS_EXPORT], bom: true });
    stringifier.pipe(stream);

    for (const r of registros) {
      stringifier.write(COLUMNAS_EXPORT.map((c) => (r as any)[c] ?? ""));
    }
    stringifier.end();

    return reply;
  });
}
```

## Registrar en server.ts

```typescript
import { register{Entidad}CsvRoutes } from "./routes/{entidades}-csv.js";

await register{Entidad}CsvRoutes(app);
```

## Dependencias

```
npm install csv-parse csv-stringify
```
