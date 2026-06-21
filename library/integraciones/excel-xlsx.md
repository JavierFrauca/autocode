# Excel — leer y generar con ExcelJS

**Categoría:** integraciones | **Cuándo usar:** Importación de datos desde ficheros .xlsx del cliente, generación de informes Excel con estilos, tablas o múltiples hojas.

## Dependencias

```
npm install exceljs
```

## Importar Excel (subida → inserción en BD)

```typescript
// routes/importar-excel.ts
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";

export async function registerExcelRoutes(app: FastifyInstance) {
  app.post("/api/productos/importar-excel", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Sin fichero" });

    const ext = file.filename.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      return reply.code(400).send({ error: "Solo se aceptan .xlsx o .xls" });
    }

    // Leer desde el stream (sin guardar en disco)
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(file.file as any);

    const hoja = workbook.getWorksheet(1); // primera hoja
    if (!hoja) return reply.code(400).send({ error: "El fichero no tiene hojas" });

    // Leer cabeceras de la primera fila
    const cabeceras: string[] = [];
    hoja.getRow(1).eachCell((cell) => cabeceras.push(String(cell.value ?? "")));

    const filas: any[] = [];

    hoja.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // saltar cabeceras

      const fila: Record<string, any> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const cabecera = cabeceras[colNumber - 1];
        // Las fechas Excel son objetos Date — convertir a ISO
        fila[cabecera] = cell.value instanceof Date
          ? cell.value.toISOString()
          : cell.value;
      });

      if (!fila["nombre"] || fila["precio"] == null) return; // saltar filas vacías

      filas.push({
        id:     crypto.randomUUID(),
        nombre: String(fila["nombre"]),
        precio: Number(fila["precio"]),
      });
    });

    if (filas.length === 0) return reply.code(400).send({ error: "No hay filas válidas" });

    await db().insert(schema.productos).values(filas).onConflictDoNothing();

    return { insertados: filas.length };
  });
}
```

## Exportar Excel (query → descarga con estilos)

```typescript
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";

app.get("/api/productos/exportar-excel", async (_req, reply) => {
  const productos = await db().select().from(schema.productos).orderBy(schema.productos.nombre);

  const workbook = new ExcelJS.Workbook();
  workbook.creator  = "AutoCode App";
  workbook.created  = new Date();

  const hoja = workbook.addWorksheet("Productos");

  // Columnas con anchos y cabeceras legibles
  hoja.columns = [
    { header: "Nombre",   key: "nombre",  width: 30 },
    { header: "Precio",   key: "precio",  width: 12 },
    { header: "Stock",    key: "stock",   width: 10 },
    { header: "Creado",   key: "creadoEn", width: 20 },
  ];

  // Estilo de la fila de cabecera
  hoja.getRow(1).font      = { bold: true };
  hoja.getRow(1).fill      = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  hoja.getRow(1).font      = { bold: true, color: { argb: "FFFFFFFF" } };

  // Datos
  for (const p of productos) {
    hoja.addRow({
      nombre:   p.nombre,
      precio:   p.precio,
      stock:    p.stock,
      creadoEn: p.creadoEn ? new Date(p.creadoEn) : null,
    });
  }

  // Formato moneda en columna precio
  hoja.getColumn("precio").numFmt = '"€"#,##0.00';

  // Formato fecha en columna creadoEn
  hoja.getColumn("creadoEn").numFmt = "dd/mm/yyyy hh:mm";

  // Enviar como stream
  const stream = new PassThrough();
  reply.raw.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.raw.setHeader("Content-Disposition", 'attachment; filename="productos.xlsx"');
  stream.pipe(reply.raw);

  await workbook.xlsx.write(stream);
  stream.end();

  return reply;
});
```

## Múltiples hojas en un mismo Excel

```typescript
const hoja1 = workbook.addWorksheet("Ventas");
const hoja2 = workbook.addWorksheet("Devoluciones");

// Misma lógica para cada hoja
hoja1.columns = [{ header: "Fecha", key: "fecha", width: 15 }, ...];
hoja2.columns = [{ header: "Motivo", key: "motivo", width: 25 }, ...];
```

## Trampas frecuentes

| Problema | Causa | Solución |
|---|---|---|
| Fechas como número (p.ej. `44927`) | Excel almacena fechas como días desde 1900 | ExcelJS las convierte a `Date` automáticamente — no uses SheetJS raw |
| Caracteres corruptos en el .xlsx | Codificación incorrecta | ExcelJS siempre UTF-8 — no hace falta BOM |
| Fichero vacío en la descarga | `stream.end()` antes de que `xlsx.write` termine | Usa `await workbook.xlsx.write(stream)` antes de `stream.end()` |
| Hoja sin datos si `eachRow` no itera | La hoja tiene filas ocultas | Usa `{ includeEmpty: false }` en `eachRow` |
