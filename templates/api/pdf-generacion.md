# Template: Generación de PDF con PDFKit

Sustituye `{Entidad}`, `{entidad}`, `{entidades}` por el nombre real.

## Ruta de descarga del PDF

```typescript
// src/routes/{entidades}-pdf.ts
import PDFDocument from "pdfkit";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

const MARGEN = 50;

export async function register{Entidad}PdfRoutes(app: FastifyInstance) {

  app.get("/api/{entidades}/:id/documento.pdf", async (req, reply) => {
    const { id } = req.params as { id: string };

    const rows = await db().select().from(schema.{entidades}).where(eq(schema.{entidades}.id, id));
    const {entidad} = rows[0];
    if (!{entidad}) return reply.code(404).send({ error: "{Entidad} no encontrada" });

    // TODO: cargar datos relacionados si los hay
    // const lineas = await db().select()...

    reply.raw.setHeader("Content-Type", "application/pdf");
    reply.raw.setHeader("Content-Disposition", `attachment; filename="{entidad}-${id}.pdf"`);

    const doc = new PDFDocument({ margin: MARGEN, size: "A4" });
    doc.pipe(reply.raw);

    construirPDF(doc, {entidad});

    doc.end();
    return reply;
  });
}

// ─── Constructor del documento ────────────────────────────────────────────────

function construirPDF(doc: PDFKit.PDFDocument, {entidad}: any) {
  const ANCHO = doc.page.width - MARGEN * 2;

  // Título
  doc.fontSize(18).font("Helvetica-Bold")
    .text("{Entidad}", MARGEN, MARGEN);

  doc.fontSize(10).font("Helvetica")
    .text(`ID: ${{entidad}.id}`,         MARGEN, 80)
    .text(`Fecha: ${hoy()}`,              MARGEN, 95);

  // Separador
  separador(doc, 120, MARGEN, ANCHO);

  // Campos del documento
  let y = 135;
  y = campoValor(doc, "Nombre",    {entidad}.nombre,    MARGEN, y, ANCHO);
  // TODO: añadir más campos según la entidad
  // y = campoValor(doc, "Estado",  {entidad}.estado,  MARGEN, y, ANCHO);

  // Pie de página
  doc.fontSize(8).fillColor("grey")
    .text("Documento generado automáticamente", MARGEN, doc.page.height - 60, {
      align: "center",
      width: ANCHO,
    });
}

// ─── Helpers de layout ────────────────────────────────────────────────────────

function separador(doc: PDFKit.PDFDocument, y: number, x: number, ancho: number) {
  doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor("#cccccc").stroke();
  doc.fillColor("black"); // restaurar color
}

function campoValor(
  doc: PDFKit.PDFDocument,
  label: string,
  valor: string | number | null | undefined,
  x: number,
  y: number,
  ancho: number,
): number {
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#666").text(label, x, y);
  doc.fontSize(10).font("Helvetica").fillColor("black").text(String(valor ?? "—"), x, y + 13, { width: ancho });
  return y + 35;
}

function hoy(): string {
  return new Date().toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}
```

## Generar en memoria (para email u otro uso)

```typescript
async function generar{Entidad}PdfBuffer({entidad}: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data",  (c) => chunks.push(c));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    construirPDF(doc, {entidad});
    doc.end();
  });
}
```

## Registrar en server.ts

```typescript
import { register{Entidad}PdfRoutes } from "./routes/{entidades}-pdf.js";

await register{Entidad}PdfRoutes(app);
```

## Dependencias

```
npm install pdfkit
npm install -D @types/pdfkit
```
