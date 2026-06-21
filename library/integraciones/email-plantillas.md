# Plantillas HTML de email

**Categoría:** integraciones | **Cuándo usar:** Junto con `email-transaccional.md`. Los emails HTML tienen sus propias reglas: sin flexbox, sin CSS externo, inline styles obligatorios, tablas para layout.

## Por qué el HTML de email es diferente

Los clientes de email (Outlook, Gmail, Apple Mail) tienen motores CSS propios y muy limitados:
- **Sin flexbox ni grid** — Outlook usa Word para renderizar HTML
- **Sin `<link>` ni `<style>` en `<head>`** — Gmail los elimina
- **Inline styles obligatorios** — es la única forma fiable
- **Tablas para layout** — sí, como en 2003, pero funciona en todos los clientes
- **Max-width 600px** — el estándar de email

## Función base — wrapper HTML

```typescript
// services/email-plantillas.ts

function baseTemplate(contenido: string, pie?: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Contenedor principal -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

          <!-- Logo / Cabecera -->
          <tr>
            <td style="background:#1e40af;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-.5px;">
                ${process.env.APP_NAME ?? "MiApp"}
              </span>
            </td>
          </tr>

          <!-- Contenido -->
          <tr>
            <td style="padding:40px 40px 32px;">
              ${contenido}
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">
                ${pie ?? `Has recibido este email porque tienes una cuenta en ${process.env.APP_NAME ?? "MiApp"}.<br>
                Si no lo has solicitado, puedes ignorarlo.`}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Helpers de estilo reutilizables
const estilo = {
  h1:     "margin:0 0 16px;font-size:24px;font-weight:700;color:#111827;line-height:1.3;",
  p:      "margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;",
  boton:  "display:inline-block;padding:13px 28px;background:#1e40af;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;",
  alerta: "padding:14px 18px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;margin:0 0 20px;font-size:14px;color:#92400e;",
  code:   "display:inline-block;padding:12px 24px;background:#f1f5f9;border-radius:6px;font-family:monospace;font-size:22px;font-weight:700;color:#1e40af;letter-spacing:4px;",
};
```

## Plantilla — Bienvenida

```typescript
export function plantillaBienvenida({ nombre }: { nombre: string }): string {
  const url = process.env.FRONTEND_URL ?? "http://localhost:5173";

  return baseTemplate(`
    <h1 style="${estilo.h1}">¡Hola, ${nombre}! 👋</h1>
    <p style="${estilo.p}">
      Tu cuenta en <strong>${process.env.APP_NAME ?? "MiApp"}</strong> está lista.
      Ya puedes empezar a usarla.
    </p>
    <p style="${estilo.p}">
      Si tienes alguna pregunta, responde a este email — te ayudamos encantados.
    </p>
    <p style="margin:28px 0 0;text-align:center;">
      <a href="${url}/dashboard" style="${estilo.boton}">Ir a mi cuenta</a>
    </p>
  `);
}
```

## Plantilla — Recuperar contraseña

```typescript
export function plantillaRecuperarPassword({
  nombre, token,
}: { nombre: string; token: string }): string {
  const url    = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const enlace = `${url}/reset-password?token=${token}`;

  return baseTemplate(`
    <h1 style="${estilo.h1}">Recupera tu contraseña</h1>
    <p style="${estilo.p}">Hola <strong>${nombre}</strong>,</p>
    <p style="${estilo.p}">
      Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.
      Haz clic en el botón de abajo para crear una nueva:
    </p>
    <p style="margin:28px 0;text-align:center;">
      <a href="${enlace}" style="${estilo.boton}">Cambiar contraseña</a>
    </p>
    <div style="${estilo.alerta}">
      ⏱ Este enlace caduca en <strong>1 hora</strong>.
      Si no has solicitado el cambio, ignora este email.
    </div>
    <p style="${estilo.p};font-size:13px;color:#6b7280;">
      Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
      <a href="${enlace}" style="color:#1e40af;word-break:break-all;">${enlace}</a>
    </p>
  `);
}
```

## Plantilla — Código de verificación (MFA / registro)

```typescript
export function plantillaCodigoVerificacion({
  nombre, codigo, motivo = "verificar tu cuenta",
}: { nombre: string; codigo: string; motivo?: string }): string {
  return baseTemplate(`
    <h1 style="${estilo.h1}">Tu código de verificación</h1>
    <p style="${estilo.p}">Hola <strong>${nombre}</strong>,</p>
    <p style="${estilo.p}">Usa el siguiente código para ${motivo}:</p>
    <p style="text-align:center;margin:28px 0;">
      <span style="${estilo.code}">${codigo}</span>
    </p>
    <div style="${estilo.alerta}">
      ⏱ Caduca en <strong>15 minutos</strong>. No lo compartas con nadie.
    </div>
  `);
}
```

## Plantilla — Notificación genérica

```typescript
export function plantillaNotificacion({
  titulo, mensaje, urlAccion, textoBoton,
}: {
  titulo:       string;
  mensaje:      string;
  urlAccion?:   string;
  textoBoton?:  string;
}): string {
  const boton = urlAccion ? `
    <p style="margin:28px 0 0;text-align:center;">
      <a href="${urlAccion}" style="${estilo.boton}">${textoBoton ?? "Ver detalles"}</a>
    </p>
  ` : "";

  return baseTemplate(`
    <h1 style="${estilo.h1}">${titulo}</h1>
    <p style="${estilo.p}">${mensaje}</p>
    ${boton}
  `);
}
```

## Plantilla — Factura con PDF adjunto

```typescript
export function plantillaFactura({
  nombre, numero, total, items,
}: {
  nombre:  string;
  numero:  string;
  total:   number;
  items:   { descripcion: string; cantidad: number; precio: number }[];
}): string {
  const filas = items.map((i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${i.descripcion}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;text-align:right;">${i.cantidad}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;text-align:right;">${formatEuros(i.precio)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;text-align:right;">${formatEuros(i.cantidad * i.precio)}</td>
    </tr>
  `).join("");

  return baseTemplate(`
    <h1 style="${estilo.h1}">Factura #${numero}</h1>
    <p style="${estilo.p}">Hola <strong>${nombre}</strong>, adjuntamos tu factura.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <th style="text-align:left;font-size:12px;color:#9ca3af;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Descripción</th>
        <th style="text-align:right;font-size:12px;color:#9ca3af;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Cant.</th>
        <th style="text-align:right;font-size:12px;color:#9ca3af;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Precio</th>
        <th style="text-align:right;font-size:12px;color:#9ca3af;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid #e5e7eb;">Total</th>
      </tr>
      ${filas}
      <tr>
        <td colspan="3" style="padding:14px 0 0;font-weight:700;font-size:15px;color:#111827;">TOTAL</td>
        <td style="padding:14px 0 0;font-weight:700;font-size:15px;color:#111827;text-align:right;">${formatEuros(total)}</td>
      </tr>
    </table>

    <p style="${estilo.p};font-size:13px;color:#6b7280;">
      El PDF de la factura está adjunto a este email.
    </p>
  `);
}

function formatEuros(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
```

## Uso con adjunto PDF

```typescript
// En un listener de domain event:
eventBus.on("PedidoCompletado", async ({ pedidoId, clienteEmail, clienteNombre }) => {
  const pedido  = await pedidoRepo.findById(pedidoId);
  const lineas  = await lineaRepo.findByPedido(pedidoId);
  const pdfBuf  = await generarPdfBuffer(pedido, lineas); // de pdf-generacion.md

  await emailService.enviar({
    para:    clienteEmail,
    asunto:  `Tu factura #${pedido.numero} de ${process.env.APP_NAME}`,
    html:    plantillaFactura({
      nombre:  clienteNombre,
      numero:  pedido.numero,
      total:   pedido.total,
      items:   lineas,
    }),
    adjuntos: [{
      filename:    `factura-${pedido.numero}.pdf`,
      content:     pdfBuf,
      contentType: "application/pdf",
    }],
  });
});
```

## Probar plantillas en desarrollo

```typescript
// GET /api/dev/email-preview/:plantilla — solo disponible en NODE_ENV !== "production"
app.get("/api/dev/email-preview/:plantilla", async (req, reply) => {
  if (process.env.NODE_ENV === "production") return reply.code(404).send();

  const { plantilla } = req.params as { plantilla: string };
  const html = {
    "bienvenida":    () => plantillaBienvenida({ nombre: "Ana García" }),
    "reset":         () => plantillaRecuperarPassword({ nombre: "Ana García", token: "abc123" }),
    "codigo":        () => plantillaCodigoVerificacion({ nombre: "Ana García", codigo: "847291" }),
    "notificacion":  () => plantillaNotificacion({ titulo: "Nuevo comentario", mensaje: "Alguien ha comentado en tu proyecto.", urlAccion: "#", textoBoton: "Ver comentario" }),
    "factura":       () => plantillaFactura({ nombre: "Ana García", numero: "2026-001", total: 242,
      items: [{ descripcion: "Plan Pro (1 mes)", cantidad: 1, precio: 200 }, { descripcion: "Soporte adicional", cantidad: 2, precio: 21 }] }),
  }[plantilla];

  if (!html) return reply.code(404).send({ error: "Plantilla desconocida" });
  return reply.type("text/html").send(html());
});
```
