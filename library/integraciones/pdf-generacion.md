# Generación de PDF con PDFKit

**Categoría:** integraciones | **Cuándo usar:** Facturas, albaranes, informes, contratos, tickets — cualquier PDF con layout programático (no renderizar HTML).

> Si el PDF debe ser una vista HTML existente renderizada (captura de pantalla), usa `puppeteer` en su lugar. PDFKit es para documentos con estructura propia.

## Dependencias

```
npm install pdfkit
npm install -D @types/pdfkit
```

## Ruta de generación (stream → descarga)

```typescript
// routes/pdf.ts
import PDFDocument from "pdfkit";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

export async function registerPdfRoutes(app: FastifyInstance) {
  app.get("/api/pedidos/:id/factura.pdf", async (req, reply) => {
    const { id } = req.params as { id: string };

    const rows = await db().select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    const pedido = rows[0];
    if (!pedido) return reply.code(404).send({ error: "Pedido no encontrado" });

    const lineas = await db().select().from(schema.lineasPedido)
      .where(eq(schema.lineasPedido.pedidoId, id));

    reply.raw.setHeader("Content-Type", "application/pdf");
    reply.raw.setHeader("Content-Disposition", `attachment; filename="factura-${id}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(reply.raw);

    generarFacturaPDF(doc, pedido, lineas);

    doc.end();
    return reply;
  });
}
```

## Layout de factura

```typescript
function generarFacturaPDF(doc: PDFKit.PDFDocument, pedido: any, lineas: any[]) {
  const MARGEN = 50;
  const ANCHO  = doc.page.width - MARGEN * 2;

  // ─── Encabezado ───────────────────────────────────────────────────────────
  doc.fontSize(20).font("Helvetica-Bold").text("FACTURA", MARGEN, MARGEN);
  doc.fontSize(10).font("Helvetica")
    .text(`Nº: ${pedido.numero}`,      MARGEN, 80)
    .text(`Fecha: ${new Date(pedido.fecha).toLocaleDateString("es-ES")}`, MARGEN, 95)
    .text(`Cliente: ${pedido.clienteNombre}`, MARGEN, 110);

  // ─── Línea separadora ─────────────────────────────────────────────────────
  doc.moveTo(MARGEN, 140).lineTo(MARGEN + ANCHO, 140).stroke();

  // ─── Cabecera de tabla ────────────────────────────────────────────────────
  let y = 155;
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Descripción", MARGEN,           y);
  doc.text("Cant.",        MARGEN + 300,    y, { width: 50, align: "right" });
  doc.text("Precio",       MARGEN + 370,    y, { width: 60, align: "right" });
  doc.text("Total",        MARGEN + 440,    y, { width: 60, align: "right" });

  doc.moveTo(MARGEN, y + 15).lineTo(MARGEN + ANCHO, y + 15).stroke();
  y += 25;

  // ─── Líneas de detalle ────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(10);
  let subtotal = 0;

  for (const linea of lineas) {
    const total = linea.cantidad * linea.precio;
    subtotal += total;

    doc.text(linea.descripcion,                  MARGEN,        y, { width: 290 });
    doc.text(String(linea.cantidad),             MARGEN + 300,  y, { width: 50,  align: "right" });
    doc.text(formatEuros(linea.precio),          MARGEN + 370,  y, { width: 60,  align: "right" });
    doc.text(formatEuros(total),                 MARGEN + 440,  y, { width: 60,  align: "right" });

    y += 20;

    // Salto de página si nos quedamos sin espacio
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = MARGEN;
    }
  }

  // ─── Totales ──────────────────────────────────────────────────────────────
  doc.moveTo(MARGEN, y + 5).lineTo(MARGEN + ANCHO, y + 5).stroke();
  y += 20;

  const iva     = subtotal * 0.21;
  const total   = subtotal + iva;

  doc.font("Helvetica-Bold");
  doc.text("Base imponible:",  MARGEN + 370, y,      { width: 70 });
  doc.text(formatEuros(subtotal), MARGEN + 440, y,   { width: 60, align: "right" });
  y += 18;
  doc.text("IVA (21%):",       MARGEN + 370, y,      { width: 70 });
  doc.text(formatEuros(iva),   MARGEN + 440, y,      { width: 60, align: "right" });
  y += 18;
  doc.text("TOTAL:",           MARGEN + 370, y,      { width: 70 });
  doc.text(formatEuros(total), MARGEN + 440, y,      { width: 60, align: "right" });

  // ─── Pie ──────────────────────────────────────────────────────────────────
  doc.fontSize(8).font("Helvetica").fillColor("grey")
    .text("Gracias por su confianza.", MARGEN, doc.page.height - 60, {
      align: "center", width: ANCHO,
    });
}

function formatEuros(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
```

## PDF en memoria (para adjuntar en email, etc.)

```typescript
import { Buffer } from "node:buffer";

async function generarPdfBuffer(pedido: any, lineas: any[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data",  (chunk) => chunks.push(chunk));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    generarFacturaPDF(doc, pedido, lineas);
    doc.end();
  });
}

// Uso desde un Command Handler
const pdfBuffer = await generarPdfBuffer(pedido, lineas);
await emailService.enviar({
  para: pedido.clienteEmail,
  asunto: `Factura ${pedido.numero}`,
  adjuntos: [{ filename: `factura-${pedido.numero}.pdf`, content: pdfBuffer }],
});
```

## Fuentes personalizadas

```typescript
// Cargar una fuente TTF del directorio /assets
doc.registerFont("MiFuente", path.join(process.cwd(), "assets", "fonts", "Roboto-Regular.ttf"));
doc.font("MiFuente").fontSize(12).text("Texto con fuente personalizada");
```

## Notas

- **Sin `async` en PDFKit**: la API es síncrona + streams; usa `pipe` o acumula chunks.
- **Imágenes**: `doc.image(path | buffer, x, y, { width: 100 })` — acepta PNG y JPEG.
- **PDFKit vs puppeteer**: PDFKit es ligero (sin Chromium) y preciso en el layout; puppeteer es mejor si ya tienes HTML con CSS y quieres capturarlo tal cual.
