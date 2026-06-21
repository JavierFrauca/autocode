# Autenticación con Microsoft Entra ID (Azure AD)

**Categoría:** auth | **Cuándo usar:** Apps para empresas que usan Microsoft 365 / Azure. Los empleados se autentican con su cuenta corporativa. También llamado "Azure Active Directory" o "Entra ID".

**Trade-offs:**
- ✅ Login con cuenta corporativa de Microsoft — sin fricción para empleados
- ✅ Hereda la seguridad de la empresa: MFA, políticas de contraseña, bloqueo por RRHH
- ✅ Acceso a Microsoft Graph (email, calendario, equipos) si se necesita
- ❌ Solo para organizaciones con Azure/M365 — no sirve para usuarios externos sin cuenta Microsoft
- ❌ Configuración inicial en Azure Portal más compleja que Google
- ❌ Puede requerir consentimiento del administrador de Azure de la empresa cliente

## Modos de uso

| Modo | Cuándo |
|---|---|
| **Single tenant** | App solo para TU empresa (un único tenant de Azure) |
| **Multi-tenant** | App SaaS que puede usarse por CUALQUIER empresa con Microsoft 365 |
| **Personal + trabajo** | Admite cuentas personales de Microsoft (Hotmail, Outlook) también |

## Configuración en Azure Portal

```
1. portal.azure.com → Microsoft Entra ID → Registros de aplicaciones → Nuevo registro
2. Nombre: MiApp
3. Tipos de cuenta admitidos:
   - "Solo esta organización" → single tenant (más restrictivo, más seguro)
   - "Cualquier organización" → multi-tenant
4. URI de redireccionamiento: Web → http://localhost:3000/api/auth/microsoft/callback
5. Copiar: Application (client) ID y Directory (tenant) ID
6. Certificados y secretos → Nuevo secreto de cliente → copiar el valor
7. Permisos de API → Microsoft Graph → openid, email, profile (permisos delegados)
```

## Variables de entorno

```env
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MICROSOFT_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# Para multi-tenant usar "common" en lugar del tenant ID
# MICROSOFT_TENANT_ID=common
MICROSOFT_CALLBACK_URL=http://localhost:3000/api/auth/microsoft/callback
FRONTEND_URL=http://localhost:5173
```

## Esquema BD

```typescript
// Añadir a la tabla usuarios
export const usuarios = pgTable("usuarios", {
  id:           text("id").primaryKey(),
  email:        text("email").notNull().unique(),
  nombre:       text("nombre").notNull(),
  avatar:       text("avatar"),
  rol:          text("rol", { enum: ["admin", "usuario"] }).notNull().default("usuario"),
  microsoftId:  text("microsoft_id").unique(),  // oid del token de Microsoft
  googleId:     text("google_id").unique(),
  passwordHash: text("password_hash"),
  tenantId:     text("tenant_id"),              // para multi-tenant: saber de qué org viene
  creadoEn:     timestamp("creado_en").notNull().defaultNow(),
  ultimoAcceso: timestamp("ultimo_acceso"),
});
```

## Implementación — flujo OAuth2 manual con MSAL

```typescript
// routes/auth-microsoft.ts
import { ConfidentialClientApplication } from "@azure/msal-node";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { firmarAccess, firmarRefresh } from "../auth/tokens.js";
import { db, schema } from "../db/client.js";

const TENANT_ID  = process.env.MICROSOFT_TENANT_ID!; // o "common" para multi-tenant
const GRAPH_ME   = "https://graph.microsoft.com/v1.0/me";
const GRAPH_PHOTO = "https://graph.microsoft.com/v1.0/me/photo/$value";

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId:     process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    authority:    `https://login.microsoftonline.com/${TENANT_ID}`,
  },
});

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path:     "/",
  maxAge:   60 * 60 * 24 * 30,
};

export async function registerMicrosoftAuthRoutes(app: FastifyInstance) {

  // Paso 1: redirigir a Microsoft
  app.get("/api/auth/microsoft", async (_req, reply) => {
    const url = await msalClient.getAuthCodeUrl({
      scopes:      ["openid", "email", "profile", "User.Read"],
      redirectUri: process.env.MICROSOFT_CALLBACK_URL!,
    });
    return reply.redirect(url);
  });

  // Paso 2: callback
  app.get("/api/auth/microsoft/callback", async (req, reply) => {
    const { code, error } = req.query as { code?: string; error?: string };

    if (error || !code) {
      return reply.redirect(`${process.env.FRONTEND_URL}/login?error=microsoft_cancelado`);
    }

    let tokenResponse;
    try {
      tokenResponse = await msalClient.acquireTokenByCode({
        code,
        scopes:      ["openid", "email", "profile", "User.Read"],
        redirectUri: process.env.MICROSOFT_CALLBACK_URL!,
      });
    } catch {
      return reply.redirect(`${process.env.FRONTEND_URL}/login?error=microsoft_token`);
    }

    // Obtener perfil desde Microsoft Graph
    const graphRes = await fetch(GRAPH_ME, {
      headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
    });
    const perfil = await graphRes.json() as {
      id: string; mail: string; displayName: string; userPrincipalName: string;
    };

    const email     = perfil.mail ?? perfil.userPrincipalName;
    const tenantId  = (tokenResponse.account as any)?.tenantId;

    // Buscar o crear usuario
    let rows = await db().select().from(schema.usuarios)
      .where(eq(schema.usuarios.microsoftId, perfil.id));
    let usuario = rows[0];

    if (!usuario) {
      const porEmail = await db().select().from(schema.usuarios)
        .where(eq(schema.usuarios.email, email));

      if (porEmail.length) {
        await db().update(schema.usuarios)
          .set({ microsoftId: perfil.id, tenantId })
          .where(eq(schema.usuarios.id, porEmail[0].id));
        usuario = { ...porEmail[0], microsoftId: perfil.id };
      } else {
        const id = ulid().toLowerCase();
        await db().insert(schema.usuarios).values({
          id,
          email,
          nombre:      perfil.displayName,
          microsoftId: perfil.id,
          tenantId,
        });
        usuario = (await db().select().from(schema.usuarios).where(eq(schema.usuarios.id, id)))[0];
      }
    }

    await db().update(schema.usuarios)
      .set({ ultimoAcceso: new Date() })
      .where(eq(schema.usuarios.id, usuario.id));

    const payload = { userId: usuario.id, email: usuario.email, rol: usuario.rol };
    const access  = firmarAccess(payload);
    const refresh = firmarRefresh(payload);

    reply.setCookie("refresh_token", refresh, COOKIE_OPTS);
    return reply.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(access)}`,
    );
  });
}
```

## Sin MSAL — flujo manual puro (alternativa sin dependencias de Microsoft)

```typescript
// Si prefieres no añadir @azure/msal-node:
const AUTH_URL  = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

// Paso 1: redirect
app.get("/api/auth/microsoft", (_req, reply) => {
  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri:  process.env.MICROSOFT_CALLBACK_URL!,
    response_mode: "query",
    scope:         "openid email profile User.Read",
  });
  return reply.redirect(`${AUTH_URL}?${params}`);
});

// Paso 2: callback con fetch manual
const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    code,
    redirect_uri:  process.env.MICROSOFT_CALLBACK_URL!,
    grant_type:    "authorization_code",
  }),
});
const tokens = await tokenRes.json() as { access_token: string };
```

## Botón de login en LoginView.vue

```vue
<template>
  <a href="/api/auth/microsoft" class="btn-microsoft">
    <img src="/microsoft-icon.svg" width="20" /> Continuar con Microsoft
  </a>
</template>
```

## Dependencias (opción con MSAL)

```
npm install @azure/msal-node
```

## Notas

- **Single tenant**: el `TENANT_ID` es el ID específico de tu organización — solo usuarios de esa org pueden acceder. Más seguro para apps internas.
- **Multi-tenant**: usa `common` como tenant — cualquier empresa M365 puede usar la app. Requiere pantalla de consentimiento de admin en el primer login de cada organización.
- **Entra External ID**: variante para usuarios externos (clientes, socios) con cuentas propias. Configuración similar pero en "External Identities" del portal.
