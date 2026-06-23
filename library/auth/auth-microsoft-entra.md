# Login con Microsoft Entra ID (Azure AD) — emite la cookie de sesión del andamiaje

**Categoría:** auth | **Cuándo usar:** Apps para empresas que usan Microsoft 365 / Azure. Los empleados
entran con su cuenta corporativa. También llamado "Azure Active Directory" o "Entra ID". Se añade SOBRE el
login propio del andamiaje (`templates/server-app`). **Esto es solo IDENTIDAD** (entrar) — para usar
OneDrive/Outlook/Teams/etc. en nombre del usuario ver `library/integraciones/microsoft-365.md`.

**Trade-offs:**
- ✅ Login con cuenta corporativa; hereda MFA y políticas de la empresa; acceso opcional a Microsoft Graph.
- ❌ Solo para organizaciones con Azure/M365; configuración inicial en Azure más compleja; puede requerir
  consentimiento del administrador del cliente.

> Convención CLAVE (coherente con el resto del andamiaje): el callback emite **la MISMA cookie de sesión** que
> el login local (`firmarSesion` + `reply.setCookie(COOKIE_SESION, …)`), y el acceso a datos va por
> `repos.usuarios` (Repository), nunca con SQL suelto ni Drizzle. Sin MSAL ni JWT access/refresh: flujo OAuth
> manual con `fetch` (cero deps) y la sesión es la cookie.

## Modos de uso

| Modo | Cuándo |
|---|---|
| **Single tenant** | App solo para TU empresa (un único tenant de Azure) |
| **Multi-tenant** | App SaaS usable por CUALQUIER empresa con Microsoft 365 (`common`) |
| **Personal + trabajo** | Admite también cuentas personales de Microsoft (Hotmail, Outlook) (`common`) |

## Configuración en Azure Portal

```
1. portal.azure.com → Microsoft Entra ID → Registros de aplicaciones → Nuevo registro
2. Nombre: MiApp
3. Tipos de cuenta admitidos:
   - "Solo esta organización" → single tenant (más restrictivo, más seguro)
   - "Cualquier organización" → multi-tenant
4. URI de redirección: Web → http://localhost:3000/api/auth/microsoft/callback
5. Copiar: Application (client) ID y Directory (tenant) ID
6. Certificados y secretos → Nuevo secreto de cliente → copiar el valor
7. Permisos de API → Microsoft Graph → openid, email, profile, User.Read (permisos delegados)
```

## Variables de entorno

```env
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MICROSOFT_TENANT_ID=common      # un tenant ID concreto = single tenant; "common" = trabajo + personal
MICROSOFT_CALLBACK_URL=http://localhost:3000/api/auth/microsoft/callback
```

## Requisito previo: extender el repo de usuarios

Añade los métodos de OAuth a `usuarios.repo.ts` (`buscarPorMicrosoftId`, `vincularProveedor`,
`crearDesdeOAuth`) una sola vez — el bloque está en `library/auth/login-system.md`.

## Rutas de login con Microsoft (`src/auth/microsoft.ts`)

```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { repos } from "../repos/index.js";
import { firmarSesion } from "./tokens.js";
import { COOKIE_SESION } from "./guard.js";
import { auditar } from "../audit.js";

const tenant = () => process.env.MICROSOFT_TENANT_ID ?? "common";
const AUTH_URL = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
const TOKEN_URL = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 8,
};

export function registerMicrosoftAuthRoutes(app: FastifyInstance): void {
  // Paso 1: redirigir a Microsoft (público: aún no hay sesión)
  app.get("/api/auth/microsoft", { config: { publico: true } }, (_req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      response_type: "code",
      redirect_uri: process.env.MICROSOFT_CALLBACK_URL!,
      response_mode: "query",
      scope: "openid email profile User.Read",
    });
    return reply.redirect(`${AUTH_URL()}?${params}`);
  });

  // Paso 2: callback — intercambiar el code, identificar/crear y emitir la cookie de sesión
  app.get("/api/auth/microsoft/callback", { config: { publico: true } }, async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error || !code) return reply.redirect("/login?error=microsoft");

    const tokenRes = await fetch(TOKEN_URL(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        code,
        redirect_uri: process.env.MICROSOFT_CALLBACK_URL!,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return reply.redirect("/login?error=microsoft_token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Perfil desde Microsoft Graph
    const perfilRes = await fetch(GRAPH_ME, { headers: { Authorization: `Bearer ${access_token}` } });
    const perfil = (await perfilRes.json()) as {
      id: string; mail: string | null; displayName: string; userPrincipalName: string;
    };
    const email = (perfil.mail ?? perfil.userPrincipalName).toLowerCase().trim();

    // Identificar o crear (por microsoft_id; si ya existe por email, vincular)
    let usuario = repos.usuarios.buscarPorMicrosoftId(perfil.id);
    if (!usuario) {
      const porEmail = repos.usuarios.buscarPorEmail(email);
      if (porEmail) {
        repos.usuarios.vincularProveedor(porEmail.id, "microsoft_id", perfil.id);
        usuario = { id: porEmail.id, email: porEmail.email, nombre: porEmail.nombre, rol: porEmail.rol };
      } else {
        const id = randomUUID();
        repos.usuarios.crearDesdeOAuth({ id, email, nombre: perfil.displayName, rol: "usuario", microsoftId: perfil.id });
        usuario = { id, email, nombre: perfil.displayName, rol: "usuario" };
      }
    }

    repos.usuarios.marcarAcceso(usuario.id, new Date().toISOString());
    const token = firmarSesion({ sub: usuario.id, email: usuario.email, rol: usuario.rol });
    reply.setCookie(COOKIE_SESION, token, cookieOpts); // ← la MISMA cookie que el login local
    auditar({ accion: "usuario.login", recurso: "usuario", recursoId: usuario.id, resultado: "ok", usuarioId: usuario.id, req });
    return reply.redirect("/");
  });
}
```

Registra `registerMicrosoftAuthRoutes(app)` en `src/server.ts` (junto a `registerAuthRoutes`).

## Encender el botón en la pantalla de login

En `web/src/views/LoginView.vue` pon `proveedoresExternos = true`. El botón es un enlace; el flujo ocurre en
el servidor y vuelve a `/` con la cookie puesta:

```vue
<a href="/api/auth/microsoft" class="btn btn-secundario">Continuar con Microsoft</a>
```

## Notas

- **Single tenant**: `MICROSOFT_TENANT_ID` = ID de tu organización — solo usuarios de esa org. Más seguro para
  apps internas. **Multi-tenant / personal+trabajo**: `common` — cualquier cuenta; la primera vez cada
  organización puede requerir consentimiento de su admin.
- Un usuario de OAuth no tiene contraseña (`password_hash` NULL) → solo entra por Microsoft.
- El callback es `{ publico: true }` (Microsoft no manda nuestra cookie); la seguridad real la pone el guard.
- Esto es LOGIN. Para llamar a Graph en nombre del usuario (OneDrive/Outlook/Teams/…) con scopes y tokens
  guardados: `library/integraciones/microsoft-365.md`.

Relacionado: ensamblado `library/auth/login-system.md`; Google `library/auth/auth-google-oauth.md`;
MFA `library/auth/auth-mfa-totp.md`; servicios Microsoft `library/integraciones/microsoft-365.md`.
