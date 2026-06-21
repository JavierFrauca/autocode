# Autenticación con MFA — TOTP (Google Authenticator / Authy)

**Categoría:** auth | **Cuándo usar:** Apps con datos sensibles (documentos privados, finanzas, salud). Se añade encima de `auth-local-completo.md` — no sustituye al login con contraseña, lo refuerza.

**Trade-offs:**
- ✅ Seguridad muy alta: incluso con la contraseña robada, el atacante necesita el dispositivo físico
- ✅ Sin coste: compatible con cualquier app TOTP gratuita (Google Authenticator, Authy, 1Password)
- ❌ Fricción adicional en el login (código de 6 dígitos cada vez)
- ❌ Si el usuario pierde el dispositivo, necesitas un flujo de recuperación (códigos de backup)

## Columnas adicionales en la tabla usuarios

```typescript
// Añadir a db/schema.ts
export const usuarios = pgTable("usuarios", {
  // ... columnas existentes de auth-local-completo.md ...
  mfaSecret:   text("mfa_secret"),         // null = MFA no activado
  mfaActivado: boolean("mfa_activado").notNull().default(false),
  mfaBackup:   text("mfa_backup"),         // JSON array de códigos de backup hasheados
});
```

## Flujo de activación del MFA

```
1. Usuario hace login normal → recibe access token
2. GET /api/auth/mfa/setup → servidor genera secreto → devuelve QR code URI
3. Usuario escanea QR con su app TOTP
4. POST /api/auth/mfa/activar { codigo } → servidor verifica el primer código → activa MFA
```

## Flujo de login con MFA activo

```
1. POST /api/auth/login → contraseña OK + MFA activo → devuelve { mfaRequired: true, tempToken }
2. Cliente muestra campo de código TOTP
3. POST /api/auth/mfa/verificar { tempToken, codigo } → verifica código → devuelve access token real
```

## Implementación

```typescript
// auth/mfa.ts
import { authenticator } from "otplib";
import QRCode from "qrcode";

const APP_NAME = process.env.APP_NAME ?? "MiApp";

export function generarSecretoMFA(): string {
  return authenticator.generateSecret(); // 20 bytes en Base32
}

export async function generarQrUri(email: string, secreto: string): Promise<string> {
  const uri = authenticator.keyuri(email, APP_NAME, secreto);
  return QRCode.toDataURL(uri); // data:image/png;base64,...
}

export function verificarCodigoTOTP(secreto: string, codigo: string): boolean {
  return authenticator.verify({ token: codigo, secret: secreto });
}
```

```typescript
// routes/mfa.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { generarSecretoMFA, generarQrUri, verificarCodigoTOTP } from "../auth/mfa.js";
import { firmarAccess } from "../auth/tokens.js";
import { db, schema } from "../db/client.js";

const TEMP_SECRET  = process.env.JWT_TEMP_SECRET!;
const TEMP_EXPIRES = "5m"; // el tempToken expira en 5 minutos

export async function registerMfaRoutes(app: FastifyInstance) {

  // Paso 1: generar secreto y QR para activar MFA
  app.get("/api/auth/mfa/setup", { preHandler: requireAuth }, async (req) => {
    const secreto = generarSecretoMFA();
    const qr      = await generarQrUri(req.user.email, secreto);

    // Guardar secreto pendiente (aún sin activar)
    await db().update(schema.usuarios)
      .set({ mfaSecret: secreto, mfaActivado: false })
      .where(eq(schema.usuarios.id, req.user.userId));

    return { qr, secreto }; // el cliente muestra el QR; secreto solo para mostrar manual
  });

  // Paso 2: confirmar primer código y activar MFA
  app.post("/api/auth/mfa/activar", { preHandler: requireAuth }, async (req, reply) => {
    const { codigo } = req.body as { codigo: string };

    const rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.id, req.user.userId));
    const usuario = rows[0];

    if (!usuario?.mfaSecret) return reply.code(400).send({ error: "MFA no inicializado" });
    if (!verificarCodigoTOTP(usuario.mfaSecret, codigo)) {
      return reply.code(401).send({ error: "Código incorrecto" });
    }

    // Generar 8 códigos de backup de un solo uso
    const backups = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase().replace(/(.{4})/, "$1-"),
    );
    const backupsHash = await Promise.all(backups.map((b) => bcrypt.hash(b, 10)));

    await db().update(schema.usuarios)
      .set({ mfaActivado: true, mfaBackup: JSON.stringify(backupsHash) })
      .where(eq(schema.usuarios.id, req.user.userId));

    return { ok: true, backupCodes: backups }; // mostrar UNA SOLA VEZ al usuario
  });

  // Login con MFA: verifica el código temporal + TOTP → emite access real
  app.post("/api/auth/mfa/verificar", async (req, reply) => {
    const { tempToken, codigo } = req.body as { tempToken: string; codigo: string };

    let payload: any;
    try {
      payload = jwt.verify(tempToken, TEMP_SECRET);
    } catch {
      return reply.code(401).send({ error: "Sesión expirada, vuelve a hacer login" });
    }

    const rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.id, payload.userId));
    const usuario = rows[0];
    if (!usuario?.mfaSecret) return reply.code(400).send({ error: "Usuario sin MFA" });

    // Intentar código TOTP normal
    if (verificarCodigoTOTP(usuario.mfaSecret, codigo)) {
      const access = firmarAccess({ userId: usuario.id, email: usuario.email, rol: usuario.rol });
      return { access, user: { id: usuario.id, email: usuario.email, nombre: usuario.nombre } };
    }

    // Intentar código de backup (de un solo uso)
    const backups: string[] = JSON.parse(usuario.mfaBackup ?? "[]");
    for (let i = 0; i < backups.length; i++) {
      if (await bcrypt.compare(codigo.toUpperCase(), backups[i])) {
        // Invalidar el código usado
        backups.splice(i, 1);
        await db().update(schema.usuarios)
          .set({ mfaBackup: JSON.stringify(backups) })
          .where(eq(schema.usuarios.id, usuario.id));
        const access = firmarAccess({ userId: usuario.id, email: usuario.email, rol: usuario.rol });
        return { access, user: { id: usuario.id, email: usuario.email, nombre: usuario.nombre } };
      }
    }

    return reply.code(401).send({ error: "Código incorrecto" });
  });

  // Desactivar MFA (requiere contraseña para confirmar)
  app.delete("/api/auth/mfa", { preHandler: requireAuth }, async (req, reply) => {
    const { password } = req.body as { password: string };
    const rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.id, req.user.userId));
    const usuario = rows[0];
    if (!await bcrypt.compare(password, usuario.passwordHash)) {
      return reply.code(401).send({ error: "Contraseña incorrecta" });
    }
    await db().update(schema.usuarios)
      .set({ mfaSecret: null, mfaActivado: false, mfaBackup: null })
      .where(eq(schema.usuarios.id, req.user.userId));
    return { ok: true };
  });
}
```

## Modificación del login para emitir tempToken si MFA activo

```typescript
// En la ruta POST /api/auth/login existente, tras validar la contraseña:
if (usuario.mfaActivado) {
  const tempToken = jwt.sign(
    { userId: usuario.id, email: usuario.email, rol: usuario.rol },
    process.env.JWT_TEMP_SECRET!,
    { expiresIn: "5m" },
  );
  // No emitir el access token todavía
  return { mfaRequired: true, tempToken };
}
// Si MFA no activo → emitir tokens normalmente
```

## Variables de entorno requeridas

```env
JWT_TEMP_SECRET=otro_secreto_diferente_para_tokens_temporales
APP_NAME=NombreDeTuApp
```

## Dependencias

```
npm install otplib qrcode
npm install -D @types/qrcode
```
