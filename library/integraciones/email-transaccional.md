# Email transaccional — envío asíncrono con Nodemailer / Resend

**Categoría:** integraciones | **Cuándo usar:** Emails de bienvenida, recuperación de contraseña, notificaciones, facturas, confirmaciones de pedido.

## Elección de proveedor

| Opción | Cuándo elegirla |
|---|---|
| **SMTP + Nodemailer** | Control total, servidor propio, o usar Gmail/Outlook/Brevo. Sin coste extra si ya tienes SMTP. |
| **Resend** | API moderna, SDK limpio, tier gratuito 3.000 emails/mes. Mejor DX para proyectos nuevos. |
| **SendGrid / Mailgun** | Volúmenes altos (>10k/mes), analytics avanzado, bounces automáticos. |

> La biblioteca usa **Nodemailer por defecto** (más universal) con Resend como alternativa directa. El `EmailService` abstrae el transporte — cambiar de proveedor es cambiar una variable de entorno.

## Variables de entorno

```env
# Opción A — SMTP
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu@gmail.com
SMTP_PASS=app-password-de-google
EMAIL_FROM="Mi App <noreply@miapp.com>"

# Opción B — Resend
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM="Mi App <noreply@miapp.com>"

# Desarrollo (Mailtrap — captura emails sin enviarlos de verdad)
# EMAIL_PROVIDER=smtp
# SMTP_HOST=sandbox.smtp.mailtrap.io
# SMTP_PORT=2525
# SMTP_USER=<mailtrap-user>
# SMTP_PASS=<mailtrap-pass>
```

## EmailService

```typescript
// services/email.ts
import nodemailer from "nodemailer";

export interface EmailOpts {
  para:      string | string[];
  asunto:    string;
  html:      string;
  texto?:    string;          // fallback plain-text
  adjuntos?: { filename: string; content: Buffer | string; contentType?: string }[];
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const provider = process.env.EMAIL_PROVIDER ?? "smtp";

    if (provider === "resend") {
      // Resend expone un endpoint SMTP compatible — no hace falta su SDK
      this.transporter = nodemailer.createTransport({
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: process.env.RESEND_API_KEY },
      });
    } else {
      this.transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST ?? "localhost",
        port:   parseInt(process.env.SMTP_PORT ?? "587"),
        secure: process.env.SMTP_PORT === "465",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }

    return this.transporter;
  }

  async enviar(opts: EmailOpts): Promise<void> {
    const t = this.getTransporter();

    await t.sendMail({
      from:        process.env.EMAIL_FROM ?? "noreply@localhost",
      to:          Array.isArray(opts.para) ? opts.para.join(",") : opts.para,
      subject:     opts.asunto,
      html:        opts.html,
      text:        opts.texto ?? htmlATexto(opts.html),
      attachments: opts.adjuntos,
    });
  }

  async verificarConexion(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      return true;
    } catch {
      return false;
    }
  }
}

export const emailService = new EmailService();

// Convierte HTML básico a texto plano para clientes que no admiten HTML
function htmlATexto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
```

## Envío asíncrono via Domain Events — el patrón correcto

```typescript
// ❌ MAL — el email bloquea la respuesta HTTP y si falla rompe el endpoint
app.post("/api/auth/registro", async (req, reply) => {
  await crearUsuario(req.body);
  await emailService.enviar({ para: req.body.email, asunto: "Bienvenido", html: "..." }); // ← bloquea
  return { ok: true };
});

// ✅ BIEN — disparar evento, el listener envía el email fuera del ciclo HTTP
app.post("/api/auth/registro", async (req, reply) => {
  const usuario = await crearUsuario(req.body);
  eventBus.emit("UsuarioRegistrado", { id: usuario.id, email: usuario.email, nombre: usuario.nombre });
  return { ok: true }; // responde inmediatamente
});
```

```typescript
// events/email-listeners.ts — registrar en server.ts al arrancar
import { eventBus }    from "./event-bus.js";
import { emailService } from "../services/email.js";
import { plantillaBienvenida, plantillaRecuperarPassword } from "../services/email-plantillas.js";

export function registerEmailListeners() {
  eventBus.on("UsuarioRegistrado", async ({ email, nombre }) => {
    try {
      await emailService.enviar({
        para:    email,
        asunto:  "¡Bienvenido a MiApp!",
        html:    plantillaBienvenida({ nombre }),
      });
    } catch (e) {
      console.error("[email] Error enviando bienvenida a", email, e);
    }
  });

  eventBus.on("SolicitudRecuperarPassword", async ({ email, nombre, token }) => {
    try {
      await emailService.enviar({
        para:   email,
        asunto: "Recupera tu contraseña",
        html:   plantillaRecuperarPassword({ nombre, token }),
      });
    } catch (e) {
      console.error("[email] Error enviando recuperación a", email, e);
    }
  });
}
```

```typescript
// server.ts
import { registerEmailListeners } from "./events/email-listeners.js";
registerEmailListeners();
```

## Recuperación de contraseña — flujo completo

```typescript
// routes/auth.ts

// 1. Solicitar recuperación
app.post("/api/auth/recuperar-password", async (req, reply) => {
  const { email } = req.body as { email: string };

  const rows = await db().select().from(schema.usuarios)
    .where(eq(schema.usuarios.email, email.toLowerCase()));

  // Siempre responder igual aunque el email no exista (evitar enumeración)
  if (rows.length) {
    const token    = crypto.randomBytes(32).toString("hex");
    const expira   = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await db().update(schema.usuarios)
      .set({ resetToken: token, resetTokenExpira: expira.toISOString() })
      .where(eq(schema.usuarios.id, rows[0].id));

    eventBus.emit("SolicitudRecuperarPassword", {
      email: rows[0].email,
      nombre: rows[0].nombre,
      token,
    });
  }

  return { ok: true, mensaje: "Si el email existe, recibirás un enlace en breve" };
});

// 2. Cambiar contraseña con el token
app.post("/api/auth/reset-password", async (req, reply) => {
  const { token, password } = req.body as { token: string; password: string };

  const rows = await db().select().from(schema.usuarios)
    .where(eq(schema.usuarios.resetToken, token));

  const usuario = rows[0];
  if (!usuario || !usuario.resetTokenExpira) {
    return reply.code(400).send({ error: "Token inválido" });
  }
  if (new Date(usuario.resetTokenExpira) < new Date()) {
    return reply.code(400).send({ error: "Token expirado — solicita uno nuevo" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db().update(schema.usuarios)
    .set({ passwordHash, resetToken: null, resetTokenExpira: null })
    .where(eq(schema.usuarios.id, usuario.id));

  return { ok: true };
});
```

## Columnas adicionales en usuarios para reset de password

```typescript
export const usuarios = pgTable("usuarios", {
  // ... columnas existentes ...
  resetToken:        text("reset_token"),
  resetTokenExpira:  text("reset_token_expira"),
});
```

## Dependencias

```
npm install nodemailer
npm install -D @types/nodemailer
```
