# Login con Google (OAuth2) — emite la cookie de sesión del andamiaje

**Categoría:** auth | **Cuándo usar:** que los usuarios entren con su cuenta Google (B2C, o empresa con
Google Workspace). Elimina la gestión de contraseñas. Se añade SOBRE el login propio del andamiaje
(`templates/server-app`), no lo sustituye. **Esto es solo IDENTIDAD** (entrar) — para usar Drive/Gmail/etc.
en nombre del usuario ver `library/integraciones/google-workspace.md`.

**Trade-offs:**
- ✅ Sin contraseñas que gestionar; login en 1 clic; el email ya viene verificado por Google.
- ❌ Dependencia de Google; requiere cuenta Google; necesita configurar Google Cloud Console.

> Convención CLAVE (coherente con el resto del andamiaje): al final del callback se emite **la MISMA cookie
> de sesión** que el login local (`firmarSesion` + `reply.setCookie(COOKIE_SESION, …)`), y el acceso a datos
> va por `repos.usuarios` (patrón Repository), nunca con SQL suelto ni Drizzle. Así el guard y el resto de la
> app no distinguen cómo entró el usuario. NO se usan JWT access/refresh aquí: la sesión es la cookie.

## Configuración en Google Cloud Console

```
1. console.cloud.google.com → Crear proyecto
2. APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth 2.0
3. Tipo de aplicación: Aplicación web
4. Orígenes JS autorizados: http://localhost:3000 (dev) + https://tudominio.com (prod)
5. URIs de redirección: http://localhost:3000/api/auth/google/callback
6. Copiar CLIENT_ID y CLIENT_SECRET
```

## Variables de entorno

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
```

## Requisito previo: extender el repo de usuarios

Añade los métodos de OAuth a `usuarios.repo.ts` (`buscarPorGoogleId`, `vincularProveedor`, `crearDesdeOAuth`)
una sola vez — el bloque está en `library/auth/login-system.md` ("Extender el repo de usuarios para OAuth").

## Rutas de login con Google (`src/auth/google.ts`)

```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { repos } from "../repos/index.js";
import { firmarSesion } from "./tokens.js";
import { COOKIE_SESION } from "./guard.js";
import { auditar } from "../audit.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

// MISMA cookie de sesión que el login local (ver src/auth/routes.ts).
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 8,
};

export function registerGoogleAuthRoutes(app: FastifyInstance): void {
  // Paso 1: redirigir a Google (público: aún no hay sesión)
  app.get("/api/auth/google", { config: { publico: true } }, (_req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  // Paso 2: callback — intercambiar el code, identificar/crear y emitir la cookie de sesión
  app.get("/api/auth/google/callback", { config: { publico: true } }, async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error || !code) return reply.redirect("/login?error=google");

    // code → access token de Google
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return reply.redirect("/login?error=google_token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // access token → perfil
    const perfilRes = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${access_token}` } });
    const perfil = (await perfilRes.json()) as { id: string; email: string; name: string };
    const email = perfil.email.toLowerCase().trim();

    // Identificar o crear el usuario (por google_id; si ya existe por email, vincular)
    let usuario = repos.usuarios.buscarPorGoogleId(perfil.id);
    if (!usuario) {
      const porEmail = repos.usuarios.buscarPorEmail(email);
      if (porEmail) {
        repos.usuarios.vincularProveedor(porEmail.id, "google_id", perfil.id);
        usuario = { id: porEmail.id, email: porEmail.email, nombre: porEmail.nombre, rol: porEmail.rol };
      } else {
        const id = randomUUID();
        repos.usuarios.crearDesdeOAuth({ id, email, nombre: perfil.name, rol: "usuario", googleId: perfil.id });
        usuario = { id, email, nombre: perfil.name, rol: "usuario" };
      }
    }

    repos.usuarios.marcarAcceso(usuario.id, new Date().toISOString());
    const token = firmarSesion({ sub: usuario.id, email: usuario.email, rol: usuario.rol });
    reply.setCookie(COOKIE_SESION, token, cookieOpts); // ← la MISMA cookie que el login local
    auditar({ accion: "usuario.login", recurso: "usuario", recursoId: usuario.id, resultado: "ok", usuarioId: usuario.id, req });
    return reply.redirect("/"); // a la app, ya con sesión
  });
}
```

Registra `registerGoogleAuthRoutes(app)` en `src/server.ts` (junto a `registerAuthRoutes`).

## Encender el botón en la pantalla de login

En `web/src/views/LoginView.vue` pon `proveedoresExternos = true` (o usa `templates/web/login-view.md`). El
botón es un simple enlace — el flujo entero ocurre en el servidor y vuelve a `/` con la cookie puesta:

```vue
<a href="/api/auth/google" class="btn btn-secundario">Continuar con Google</a>
```

## Reglas

- Un usuario de OAuth no tiene contraseña (`password_hash` NULL) → el login local lo rechaza solo (bcrypt
  contra un hash falso); solo entra por Google. Bien.
- Vincula por email si la cuenta ya existía (login local previo) para no duplicar usuarios.
- El callback es `{ publico: true }` (Google no manda nuestra cookie); la seguridad real la pone el guard en
  el resto de `/api`.
- Esto es LOGIN. Para llamar a las APIs de Google en nombre del usuario (Drive/Gmail/Calendar/Sheets/Contacts/
  Tasks) necesitas tokens con scopes y guardarlos: `library/integraciones/google-workspace.md`.

Relacionado: ensamblado `library/auth/login-system.md`; Microsoft `library/auth/auth-microsoft-entra.md`;
MFA `library/auth/auth-mfa-totp.md`; servicios Google `library/integraciones/google-workspace.md`.
