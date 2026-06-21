# Template: Importar y exportar Excel (.xlsx)

Sustituye `{Entidad}`, `{entidad}`, `{entidades}`, `{tabla}` por el nombre real.

## Ruta importar + exportar Excel

```typescript
// src/routes/{entidades}-excel.ts
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";

// Definición de columnas — orden importa para la exportación
const COLUMNAS: { header: string; key: string; width: number; numFmt?: string }[] = [
  { header: "Nombre",    key: "nombre",    width: 30 },
  { header: "Precio",    key: "precio",    width: 12, numFmt: '"€"#,##0.00' },
  { header: "Stock",     key: "stock",     width: 10 },
  { header: "Creado",    key: "creadoEn",  width: 20, numFmt: "dd/mm/yyyy hh:mm" },
];

export async function register{Entidad}ExcelRoutes(app: FastifyInstance) {

  // ─── IMPORTAR ──────────────────────────────────────────────────────────────
  app.post("/api/{entidades}/importar-excel", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Sin fichero" });

    const ext = file.filename.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      return reply.code(400).send({ error: "Solo se aceptan .xlsx o .xls" });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(file.file as any);

    const hoja = workbook.getWorksheet(1);
    if (!hoja) return reply.code(400).send({ error: "El fichero no tiene hojas" });

    // Leer cabeceras de la primera fila
    const cabeceras: string[] = [];
    hoja.getRow(1).eachCell((cell) => {
      cabeceras.push(String(cell.value ?? "").toLowerCase());
    });

    const filas: (typeof schema.{tabla}.$inferInsert)[] = [];

    hoja.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const fila: Record<string, any> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const key = cabeceras[colNum - 1];
        fila[key] = cell.value instanceof Date ? cell.value.toISOString() : cell.value;
      });

      if (!fila["nombre"]) return; // saltar vacías

      filas.push({
        id:       crypto.randomUUID(),
        nombre:   String(fila["nombre"]),
        precio:   Number(fila["precio"] ?? 0),
        // ... resto de campos
        creadoEn: new Date().toISOString(),
      });
    });

    if (filas.length === 0) return reply.code(400).send({ error: "Sin filas válidas" });

    await db().insert(schema.{tabla}).values(filas).onConflictDoNothing();

    return { insertados: filas.length };
  });

  // ─── EXPORTAR ──────────────────────────────────────────────────────────────
  app.get("/api/{entidades}/exportar-excel", async (_req, reply) => {
    const registros = await db().select().from(schema.{tabla});

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "AutoCode App";
    workbook.created = new Date();

    const hoja = workbook.addWorksheet("{Entidades}");
    hoja.columns = COLUMNAS;

    // Cabecera en negrita con fondo azul
    const filaCabecera = hoja.getRow(1);
    filaCabecera.font = { bold: true, color: { argb: "FFFFFFFF" } };
    filaCabecera.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };

    for (const r of registros) {
      const rowData: Record<string, any> = {};
      for (const col of COLUMNAS) {
        const v = (r as any)[col.key];
        rowData[col.key] = (col.numFmt?.includes("yyyy") && v) ? new Date(v) : v;
      }
      hoja.addRow(rowData);
    }

    // Aplicar formatos numéricos definidos en COLUMNAS
    for (const col of COLUMNAS) {
      if (col.numFmt) hoja.getColumn(col.key).numFmt = col.numFmt;
    }

    const stream = new PassThrough();
    reply.raw.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    reply.raw.setHeader("Content-Disposition", `attachment; filename="{entidades}.xlsx"`);
    stream.pipe(reply.raw);

    await workbook.xlsx.write(stream);
    stream.end();

    return reply;
  });
}
```

## Registrar en server.ts

```typescript
import { register{Entidad}ExcelRoutes } from "./routes/{entidades}-excel.js";

await register{Entidad}ExcelRoutes(app);
```

## Dependencias

```
npm install exceljs
```
