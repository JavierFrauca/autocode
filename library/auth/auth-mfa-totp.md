# MFA por TOTP (Google Authenticator / Authy) — sobre el login del andamiaje

**Categoría:** auth | **Cuándo usar:** apps con datos sensibles (documentos privados, finanzas, salud). Se
añade ENCIMA del login con contraseña del andamiaje (`templates/server-app`) — no lo sustituye, lo refuerza.

**Trade-offs:**
- ✅ Seguridad muy alta: aun con la contraseña robada, hace falta el dispositivo físico. Sin coste (cualquier
  app TOTP gratuita).
- ❌ Fricción extra (código de 6 dígitos). Si se pierde el dispositivo, hacen falta códigos de respaldo.

> Convención CLAVE: coherente con el andamiaje — **cero dependencias** (TOTP con `node:crypto`, ni `otplib` ni
> `qrcode` ni `jsonwebtoken`), acceso por `repos.usuarios` (Repository), y al superar el 2º factor se emite **la
> MISMA cookie de sesión** (`firmarSesion` + `COOKIE_SESION`). La columna `mfa_secret` ya existe en `usuarios`.

## Esquema — una columna más para los códigos de respaldo

En `initDb` (`src/db.ts`), la tabla `usuarios` ya trae `mfa_secret`; añade `mfa_backup`:

```sql
-- en CREATE TABLE usuarios (...): mfa_secret ya está; añade:
mfa_backup TEXT          -- JSON de códigos de respaldo hasheados (null si no hay)
```

Regla: **`mfa_secret` no null = MFA activo**. Durante el alta el secreto NO se guarda hasta confirmar el
primer código (así no queda un MFA "a medias" que bloquee al usuario).

## TOTP sin dependencias (`src/auth/totp.ts`)

```ts
import { createHmac, randomBytes } from "node:crypto";

const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // Base32 (RFC 4648)

function base32Encode(buf: Buffer): string {
  let bits = 0, valor = 0, out = "";
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { out += ALFA[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALFA[(valor << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Buffer {
  let bits = 0, valor = 0; const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const i = ALFA.indexOf(c); if (i < 0) continue;
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generarSecretoMfa(): string { return base32Encode(randomBytes(20)); }

function codigoEn(secretBase32: string, t: number, paso = 30): string {
  const contador = Math.floor(t / 1000 / paso);
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(contador));
  const h = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const cod = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return (cod % 1_000_000).toString().padStart(6, "0");
}

/** Verifica con ±1 ventana de 30 s para tolerar desfase de reloj. */
export function verificarTotp(secret: string, codigo: string, ventana = 1): boolean {
  const ahora = Date.now();
  for (let i = -ventana; i <= ventana; i++) if (codigoEn(secret, ahora + i * 30_000) === codigo) return true;
  return false;
}

/** URI estándar para que la app de autenticación lo añada (por QR o a mano). */
export function otpauthUri(email: string, secret: string): string {
  const app = process.env.APP_NAME ?? "MiApp";
  return `otpauth://totp/${encodeURIComponent(app)}:${encodeURIComponent(email)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(app)}&period=30&digits=6`;
}
```

> QR: el servidor no genera imágenes (cero deps). Devuelve el `otpauthUri` + el secreto para alta manual; el
> FRONT puede pintar el QR a partir del URI con un componente cliente ligero si quieres mejor UX.

## Repo — métodos de MFA en `usuarios.repo.ts`

```ts
// interface UsuariosRepo
leerMfa(id: string): { mfaSecret: string | null; mfaBackup: string | null } | undefined;
guardarMfaSecret(id: string, secret: string | null): void;
guardarBackup(id: string, backupJson: string | null): void;

// UsuariosRepoSqlite
leerMfa(id) {
  return getDb().prepare("SELECT mfa_secret AS mfaSecret, mfa_backup AS mfaBackup FROM usuarios WHERE id = ?")
    .get(id) as { mfaSecret: string | null; mfaBackup: string | null } | undefined;
}
guardarMfaSecret(id, secret) { getDb().prepare("UPDATE usuarios SET mfa_secret = ? WHERE id = ?").run(secret, id); }
guardarBackup(id, backupJson) { getDb().prepare("UPDATE usuarios SET mfa_backup = ? WHERE id = ?").run(backupJson, id); }
```

## Token "MFA pendiente" entre los dos pasos del login (`src/auth/mfa-pending.ts`)

Es como la cookie de sesión pero corto y marcado como pendiente (mismo HMAC, sin meter una sesión real):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const SECRET = process.env.AUTH_SECRET ?? "dev-secret-cambia-esto-en-produccion";

export function firmarPendiente(sub: string, ttl = 300): string {
  const body = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttl })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
export function verificarPendiente(token: string | undefined): string | null {
  if (!token) return null;
  const [body, firma] = token.split(".");
  if (!body || !firma) return null;
  const esp = createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(firma), b = Buffer.from(esp);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { sub: string; exp: number };
    return p.exp < Math.floor(Date.now() / 1000) ? null : p.sub;
  } catch { return null; }
}
```

## Cambio en el login (`src/auth/routes.ts`)

Tras validar la contraseña, si el usuario tiene MFA NO emitas la cookie todavía:

```ts
// dentro de POST /api/auth/login, después de comprobar bcrypt y `u.activo`:
if (repos.usuarios.leerMfa(u.id)?.mfaSecret) {
  return { mfaRequired: true, pending: firmarPendiente(u.id) }; // el front pide el código
}
// si no, sigue igual: firmarSesion + reply.setCookie(COOKIE_SESION, …)
```

## Rutas de MFA (`src/auth/mfa.ts`)

```ts
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { repos } from "../repos/index.js";
import { firmarSesion } from "./tokens.js";
import { COOKIE_SESION } from "./guard.js";
import { generarSecretoMfa, verificarTotp, otpauthUri } from "./totp.js";
import { verificarPendiente } from "./mfa-pending.js";
import { auditar } from "../audit.js";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 8 };

export function registerMfaRoutes(app: FastifyInstance): void {
  // Alta paso 1: generar secreto (NO se guarda aún) — usuario ya autenticado (lo pone el guard)
  app.get("/api/auth/mfa/setup", async (req) => {
    const secreto = generarSecretoMfa();
    return { secreto, uri: otpauthUri(req.usuario!.email, secreto) }; // el front guarda `secreto` para el paso 2
  });

  // Alta paso 2: confirmar el primer código → activar + devolver códigos de respaldo (UNA vez)
  app.post("/api/auth/mfa/activar", async (req, reply) => {
    const { secreto, codigo } = req.body as { secreto: string; codigo: string };
    if (!verificarTotp(secreto, codigo)) return reply.code(401).send({ error: "Código incorrecto" });

    const respaldo = Array.from({ length: 8 }, () => randomBytes(4).toString("hex").toUpperCase());
    const hashes = await Promise.all(respaldo.map((c) => bcrypt.hash(c, 10)));
    repos.usuarios.guardarMfaSecret(req.usuario!.sub, secreto);
    repos.usuarios.guardarBackup(req.usuario!.sub, JSON.stringify(hashes));
    auditar({ accion: "usuario.mfa.activar", recurso: "usuario", recursoId: req.usuario!.sub, resultado: "ok", usuarioId: req.usuario!.sub, req });
    return { ok: true, respaldo }; // muéstralos UNA sola vez
  });

  // Login paso 2: verificar el código (o uno de respaldo) → emitir la cookie de sesión real
  app.post("/api/auth/mfa/verificar", { config: { publico: true } }, async (req, reply) => {
    const { pending, codigo } = req.body as { pending: string; codigo: string };
    const sub = verificarPendiente(pending);
    if (!sub) return reply.code(401).send({ error: "Sesión expirada, vuelve a entrar" });

    const u = repos.usuarios.buscarPorId(sub);
    const mfa = repos.usuarios.leerMfa(sub);
    if (!u || !mfa?.mfaSecret) return reply.code(400).send({ error: "Usuario sin MFA" });

    let ok = verificarTotp(mfa.mfaSecret, codigo);
    if (!ok && mfa.mfaBackup) { // probar código de respaldo (un solo uso)
      const restantes: string[] = JSON.parse(mfa.mfaBackup);
      for (let i = 0; i < restantes.length; i++) {
        if (await bcrypt.compare(codigo.toUpperCase(), restantes[i])) {
          restantes.splice(i, 1);
          repos.usuarios.guardarBackup(sub, JSON.stringify(restantes));
          ok = true; break;
        }
      }
    }
    if (!ok) { auditar({ accion: "usuario.login", recurso: "usuario", resultado: "denegado", usuarioId: sub, req }); return reply.code(401).send({ error: "Código incorrecto" }); }

    repos.usuarios.marcarAcceso(u.id, new Date().toISOString());
    const token = firmarSesion({ sub: u.id, email: u.email, rol: u.rol });
    reply.setCookie(COOKIE_SESION, token, cookieOpts);
    auditar({ accion: "usuario.login", recurso: "usuario", recursoId: u.id, resultado: "ok", usuarioId: u.id, req });
    return { usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } };
  });

  // Desactivar MFA (pide la contraseña para confirmar)
  app.delete("/api/auth/mfa", async (req, reply) => {
    const { password } = req.body as { password: string };
    const u = repos.usuarios.buscarPorEmail(req.usuario!.email);
    if (!u?.passwordHash || !(await bcrypt.compare(password, u.passwordHash))) {
      return reply.code(401).send({ error: "Contraseña incorrecta" });
    }
    repos.usuarios.guardarMfaSecret(req.usuario!.sub, null);
    repos.usuarios.guardarBackup(req.usuario!.sub, null);
    return { ok: true };
  });
}
```

Registra `registerMfaRoutes(app)` en `src/server.ts`. En el front: si el login responde `{ mfaRequired: true,
pending }`, muestra el campo del código y POSTea a `/api/auth/mfa/verificar` con `{ pending, codigo }`.

## Reglas

- Guarda los **códigos de respaldo** hasheados (bcrypt) y muéstralos en claro UNA vez al activar.
- El paso 2 del login (`/mfa/verificar`) es `{ publico: true }` (aún no hay cookie); el `pending` firmado es lo
  que prueba que ya pasó la contraseña.
- MFA se apila igual sobre el login local Y sobre Google/Microsoft si quieres forzarlo (tras el callback,
  comprueba `leerMfa` antes de emitir la cookie).

Relacionado: ensamblado `library/auth/login-system.md`; login base (en el andamiaje); Google/Microsoft
`library/auth/auth-google-oauth.md`, `library/auth/auth-microsoft-entra.md`.
