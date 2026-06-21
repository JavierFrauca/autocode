# Autenticación con Google OAuth2

**Categoría:** auth | **Cuándo usar:** Apps donde los usuarios ya tienen cuenta Google (B2C, apps internas de empresa con Google Workspace). Elimina la gestión de contraseñas.

**Trade-offs:**
- ✅ Sin contraseñas que gestionar — la seguridad de la cuenta la da Google (con MFA de Google)
- ✅ Login en 1 clic — muy baja fricción para el usuario final
- ✅ El email ya está verificado (Google lo garantiza)
- ❌ Dependencia de Google — si el servicio cae, el login cae con él
- ❌ Requiere cuenta Google — no sirve para usuarios con otras cuentas
- ❌ Necesita configuración en Google Cloud Console y dominio verificable para producción

## Configuración en Google Cloud Console

```
1. Ir a console.cloud.google.com → Crear proyecto
2. APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth 2.0
3. Tipo de aplicación: Aplicación web
4. Orígenes JS autorizados: http://localhost:3000 (dev) + https://tudominio.com (prod)
5. URIs de redireccionamiento: http://localhost:3000/api/auth/google/callback
6. Copiar CLIENT_ID y CLIENT_SECRET
```

## Variables de entorno

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
FRONTEND_URL=http://localhost:5173
```

## Esquema BD — usuarios sin contraseña

```typescript
// Añadir a la tabla usuarios (compatible con auth-local si se usa auth mixta)
export const usuarios = pgTable("usuarios", {
  id:           text("id").primaryKey(),
  email:        text("email").notNull().unique(),
  nombre:       text("nombre").notNull(),
  avatar:       text("avatar"),
  rol:          text("rol", { enum: ["admin", "usuario"] }).notNull().default("usuario"),
  // OAuth providers — null si solo usa login local
  googleId:     text("google_id").unique(),
  passwordHash: text("password_hash"),   // null si solo usa OAuth
  creadoEn:     timestamp("creado_en").notNull().defaultNow(),
  ultimoAcceso: timestamp("ultimo_acceso"),
});
```

## Implementación — flujo OAuth2 manual (sin Passport)

```typescript
// routes/auth-google.ts
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { firmarAccess, firmarRefresh } from "../auth/tokens.js";
import { db, schema } from "../db/client.js";

const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v2/userinfo";

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path:     "/",
  maxAge:   60 * 60 * 24 * 30,
};

export async function registerGoogleAuthRoutes(app: FastifyInstance) {

  // Paso 1: redirigir a Google
  app.get("/api/auth/google", (_req, reply) => {
    const params = new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      redirect_uri:  process.env.GOOGLE_CALLBACK_URL!,
      response_type: "code",
      scope:         "openid email profile",
      access_type:   "offline",
      prompt:        "select_account",
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  // Paso 2: callback — intercambiar código por tokens
  app.get("/api/auth/google/callback", async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string };

    if (error || !code) {
      return reply.redirect(`${process.env.FRONTEND_URL}/login?error=google_cancelado`);
    }

    // Intercambiar código por access token de Google
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri:  process.env.GOOGLE_CALLBACK_URL!,
        grant_type:    "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return reply.redirect(`${process.env.FRONTEND_URL}/login?error=google_token`);
    }

    const tokens     = await tokenRes.json() as { access_token: string };
    const profileRes = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const perfil = await profileRes.json() as {
      id: string; email: string; name: string; picture: string;
    };

    // Buscar o crear usuario
    const rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.googleId, perfil.id));

    let usuario = rows[0];

    if (!usuario) {
      // Comprobar si ya existe por email (login local previo)
      const porEmail = await db().select().from(schema.usuarios)
        .where(eq(schema.usuarios.email, perfil.email));

      if (porEmail.length) {
        // Vincular Google a la cuenta existente
        await db().update(schema.usuarios)
          .set({ googleId: perfil.id, avatar: perfil.picture })
          .where(eq(schema.usuarios.id, porEmail[0].id));
        usuario = { ...porEmail[0], googleId: perfil.id };
      } else {
        // Crear cuenta nueva
        const id = ulid().toLowerCase();
        await db().insert(schema.usuarios).values({
          id,
          email:    perfil.email,
          nombre:   perfil.name,
          avatar:   perfil.picture,
          googleId: perfil.id,
        });
        usuario = (await db().select().from(schema.usuarios).where(eq(schema.usuarios.id, id)))[0];
      }
    }

    // Actualizar último acceso y avatar
    await db().update(schema.usuarios)
      .set({ ultimoAcceso: new Date(), avatar: perfil.picture })
      .where(eq(schema.usuarios.id, usuario.id));

    // Emitir tokens propios de la app
    const payload = { userId: usuario.id, email: usuario.email, rol: usuario.rol };
    const access  = firmarAccess(payload);
    const refresh = firmarRefresh(payload);

    reply.setCookie("refresh_token", refresh, COOKIE_OPTS);

    // Redirigir al frontend con el access token (pasarlo por query param o fragment)
    return reply.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(access)}`,
    );
  });
}
```

## Cliente Vue — recibir el token del callback

```typescript
// views/AuthCallback.vue
import { onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuth } from "../composables/useAuth.js";

const route  = useRoute();
const router = useRouter();
const { setToken } = useAuth();

onMounted(() => {
  const token = route.query.token as string;
  if (token) {
    setToken(token);
    router.push("/dashboard");
  } else {
    router.push("/login?error=1");
  }
});
```

## Botón de login en LoginView.vue

```vue
<template>
  <a href="/api/auth/google" class="btn-google">
    <img src="/google-icon.svg" width="20" /> Continuar con Google
  </a>
</template>
```
