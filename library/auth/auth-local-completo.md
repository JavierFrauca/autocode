# Autenticación local completa — email + contraseña + JWT

**Categoría:** auth | **Cuándo usar:** La opción base para cualquier app. Sin dependencias de proveedores externos. Combina bien con MFA (ver `auth-mfa-totp.md`).

**Trade-offs vs otras opciones:**
- ✅ Sin dependencias externas, control total, funciona offline
- ✅ La más sencilla de auditar y depurar
- ❌ El usuario gestiona su contraseña (riesgo de olvido, reutilización)
- ❌ Tú gestionas la seguridad (hash, reset, brechas)

## Esquema BD (Drizzle + PostgreSQL)

```typescript
// db/schema.ts
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const usuarios = pgTable("usuarios", {
  id:           text("id").primaryKey(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nombre:       text("nombre").notNull(),
  rol:          text("rol", { enum: ["admin", "usuario"] }).notNull().default("usuario"),
  activo:       boolean("activo").notNull().default(true),
  creadoEn:     timestamp("creado_en").notNull().defaultNow(),
  ultimoAcceso: timestamp("ultimo_acceso"),
});
```

## Tokens — access (15 min) + refresh (30 días)

```typescript
// auth/tokens.ts
import jwt from "jsonwebtoken";

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export interface TokenPayload { userId: string; email: string; rol: string; }

export function firmarAccess(payload: TokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "15m" });
}

export function firmarRefresh(payload: TokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "30d" });
}

export function verificarAccess(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

export function verificarRefresh(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
}

// Extender Fastify
declare module "fastify" {
  interface FastifyRequest { user: TokenPayload; }
}
```

## Rutas de autenticación

```typescript
// routes/auth.ts
import bcrypt from "bcryptjs";
import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/client.js";
import { firmarAccess, firmarRefresh, verificarRefresh } from "../auth/tokens.js";

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path:     "/",
  maxAge:   60 * 60 * 24 * 30, // 30 días en segundos
};

export async function registerAuthRoutes(app: FastifyInstance) {

  // ── Registro ─────────────────────────────────────────────────────────────
  app.post("/api/auth/registro", async (req, reply) => {
    const { email, password, nombre } = req.body as any;

    const existe = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.email, email.toLowerCase().trim()));
    if (existe.length) return reply.code(409).send({ error: "Email ya registrado" });

    const passwordHash = await bcrypt.hash(password, 12);
    const id           = ulid().toLowerCase();

    await db().insert(schema.usuarios).values({
      id,
      email:  email.toLowerCase().trim(),
      passwordHash,
      nombre: nombre.trim(),
    });

    return reply.code(201).send({ ok: true });
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = req.body as any;

    const rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.email, email.toLowerCase().trim()));
    const usuario = rows[0];

    // Timing-safe: siempre comparar aunque no exista el usuario
    const hash   = usuario?.passwordHash ?? "$2b$12$invalido.hash.para.evitar.timing";
    const valido = await bcrypt.compare(password, hash);

    if (!usuario || !valido || !usuario.activo) {
      return reply.code(401).send({ error: "Credenciales incorrectas" });
    }

    // Actualizar último acceso
    await db().update(schema.usuarios)
      .set({ ultimoAcceso: new Date() })
      .where(eq(schema.usuarios.id, usuario.id));

    const payload = { userId: usuario.id, email: usuario.email, rol: usuario.rol };
    const access  = firmarAccess(payload);
    const refresh = firmarRefresh(payload);

    reply.setCookie("refresh_token", refresh, COOKIE_OPTS);
    return { access, user: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol } };
  });

  // ── Renovar access token ──────────────────────────────────────────────────
  app.post("/api/auth/refresh", async (req, reply) => {
    const token = req.cookies["refresh_token"];
    if (!token) return reply.code(401).send({ error: "Sin refresh token" });

    try {
      const payload = verificarRefresh(token);
      const access  = firmarAccess({ userId: payload.userId, email: payload.email, rol: payload.rol });
      return { access };
    } catch {
      return reply.code(401).send({ error: "Refresh token inválido o expirado" });
    }
  });

  // ── Perfil ────────────────────────────────────────────────────────────────
  app.get("/api/auth/me", { preHandler: requireAuth }, async (req) => {
    const rows = await db().select({
      id: schema.usuarios.id, email: schema.usuarios.email,
      nombre: schema.usuarios.nombre, rol: schema.usuarios.rol,
    }).from(schema.usuarios).where(eq(schema.usuarios.id, req.user.userId));
    return rows[0] ?? null;
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("refresh_token", { path: "/" });
    return { ok: true };
  });
}

// ── Middleware reutilizable ───────────────────────────────────────────────────
import { verificarAccess } from "../auth/tokens.js";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "No autenticado" });
  try {
    req.user = verificarAccess(header.slice(7));
  } catch {
    return reply.code(401).send({ error: "Token inválido o expirado" });
  }
}
```

## Composable Vue — useAuth

```typescript
// composables/useAuth.ts
import { ref, computed } from "vue";
import { useRouter } from "vue-router";

interface Usuario { id: string; email: string; nombre: string; rol: string; }

const usuario   = ref<Usuario | null>(null);
const accessToken = ref<string | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function useAuth() {
  const router        = useRouter();
  const autenticado   = computed(() => !!usuario.value);
  const esAdmin       = computed(() => usuario.value?.rol === "admin");

  async function login(email: string, password: string) {
    const r = await fetch("/api/auth/login", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    const data = await r.json();
    accessToken.value = data.access;
    usuario.value     = data.user;
    programarRefresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    usuario.value     = null;
    accessToken.value = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    router.push("/login");
  }

  async function refresh() {
    const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!r.ok) { logout(); return; }
    const data        = await r.json();
    accessToken.value = data.access;
    programarRefresh();
  }

  function programarRefresh() {
    // Renovar 1 minuto antes de que expire (14 min)
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 14 * 60 * 1000);
  }

  // Añadir el token a fetch automáticamente
  function authFetch(url: string, init: RequestInit = {}) {
    return fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken.value}`,
      },
    });
  }

  return { usuario, autenticado, esAdmin, login, logout, refresh, authFetch };
}
```

## Variables de entorno requeridas

```env
JWT_ACCESS_SECRET=cambia_esto_por_un_secreto_largo_aleatorio_1
JWT_REFRESH_SECRET=cambia_esto_por_otro_secreto_diferente_2
```

## Dependencias

```
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs
```
