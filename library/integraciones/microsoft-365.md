# Servicios de Microsoft 365 (OneDrive, Outlook, Calendar, Teams, Contacts, To Do)

**Categoría:** integraciones | **Cuándo usar:** la app necesita LEER o ESCRIBIR en la cuenta de Microsoft
365 / Outlook de cada usuario: ficheros en **OneDrive**, enviar/leer **correo de Outlook**, eventos de
**Calendar**, mensajes de **Teams**, **Contactos** y tareas de **To Do**. Es el equivalente Microsoft de
`library/integraciones/google-workspace.md`.

Esto es DISTINTO del **login** con Microsoft (`library/auth/auth-microsoft-entra.md`, que solo identifica al
usuario con `openid email profile`). Aquí el usuario **autoriza** a la app a actuar EN SU NOMBRE sobre
ciertos datos (scopes de Graph) y se guarda un **refresh token** para mantener el acceso.

**Ventaja de Microsoft:** todo va por **UNA sola API, Microsoft Graph** (`https://graph.microsoft.com/v1.0`)
→ los clientes son aún más finos que en Google. **Cero dependencias npm**: se llama a Graph con `fetch`
(no hace falta `@azure/msal-node` ni el SDK de Graph).

## Pieza preparada — la idea (idéntica a la de Google)

1. **Conexión** (`graphTokenDe`): una vez conectada la cuenta, devuelve un *access token* fresco para ese
   usuario (lo renueva con el refresh token cuando caduca). Único punto que toca OAuth.
2. **Clientes finos**: OneDrive/Outlook/Calendar/Teams/Contacts/To Do son módulos pequeños que piden el
   token y llaman a Graph. Añadir otra capacidad de Graph = otro módulo de ~15 líneas.

## Configuración en Azure (decírselo en lenguaje llano)

1. `portal.azure.com` → **Microsoft Entra ID → Registros de aplicaciones → Nuevo registro**. Tipos de
   cuenta: "Cualquier organización" (multi-tenant) o "+ personales" si admites Outlook/Hotmail.
2. **URI de redirección** (Web): `http://localhost:3000/api/microsoft/callback` (dev) + la de producción.
3. **Certificados y secretos → Nuevo secreto de cliente** → copiar el valor.
4. **Permisos de API → Microsoft Graph → Permisos delegados**: añade los scopes que use la app (ver abajo)
   + **`offline_access`** (imprescindible para el refresh token). Algunos permisos pueden requerir
   **consentimiento del administrador** del tenant del cliente.

```env
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MICROSOFT_TENANT=common                 # "common" = trabajo + personal; o el TENANT_ID de la empresa
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/microsoft/callback
FRONTEND_URL=http://localhost:5173
```

### Scopes por servicio (pide SOLO lo que uses; añade SIEMPRE `offline_access`)

| Servicio | Scope delegado de Graph | Para qué |
|----------|-------------------------|----------|
| Perfil | `User.Read` | datos básicos del usuario (recomendado de base) |
| OneDrive | `Files.ReadWrite` | subir/leer ficheros del usuario |
| Outlook enviar | `Mail.Send` | enviar correo como el usuario |
| Outlook leer | `Mail.Read` | leer correo |
| Calendar | `Calendars.ReadWrite` | crear/editar eventos |
| Contacts | `Contacts.ReadWrite` | leer/crear contactos |
| To Do (tareas) | `Tasks.ReadWrite` | leer/crear tareas |
| Teams leer | `Chat.Read` | leer chats del usuario |
| Teams publicar | `ChannelMessage.Send` | publicar en un canal (suele requerir consentimiento admin) |

## Almacén del token por usuario (repo, igual que el resto del andamiaje)

La columna `microsoft_id` ya existe en la tabla `usuarios` del andamiaje. Añade una tabla para el token
(patrón Repository, como `items.repo.ts`). En `initDb` (`src/db.ts`):

```sql
CREATE TABLE IF NOT EXISTS ms_conexiones (
  usuario_id    TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expira        INTEGER,            -- epoch ms en que caduca el access_token
  scopes        TEXT NOT NULL,
  email_ms      TEXT,
  creado        TEXT NOT NULL
);
```

```ts
// src/repos/ms-conexiones.repo.ts
import { getDb } from "../db.js";

export interface MsConexion {
  usuarioId: string; refreshToken: string; accessToken: string | null;
  expira: number | null; scopes: string; emailMs: string | null;
}

export interface MsConexionesRepo {
  obtener(usuarioId: string): MsConexion | null;
  guardar(c: MsConexion): void;
  actualizarTokens(usuarioId: string, accessToken: string, refreshToken: string, expira: number): void;
  borrar(usuarioId: string): void;
}

export class MsConexionesRepoSqlite implements MsConexionesRepo {
  obtener(usuarioId: string): MsConexion | null {
    const r = getDb().prepare(
      `SELECT usuario_id as usuarioId, refresh_token as refreshToken, access_token as accessToken,
              expira, scopes, email_ms as emailMs
         FROM ms_conexiones WHERE usuario_id = ?`).get(usuarioId) as MsConexion | undefined;
    return r ?? null;
  }
  guardar(c: MsConexion): void {
    getDb().prepare(
      `INSERT INTO ms_conexiones (usuario_id, refresh_token, access_token, expira, scopes, email_ms, creado)
       VALUES (@usuarioId, @refreshToken, @accessToken, @expira, @scopes, @emailMs, @creado)
       ON CONFLICT(usuario_id) DO UPDATE SET
         refresh_token=excluded.refresh_token, access_token=excluded.access_token,
         expira=excluded.expira, scopes=excluded.scopes, email_ms=excluded.email_ms`)
      .run({ ...c, creado: new Date().toISOString() });
  }
  actualizarTokens(usuarioId: string, accessToken: string, refreshToken: string, expira: number): void {
    getDb().prepare("UPDATE ms_conexiones SET access_token=?, refresh_token=?, expira=? WHERE usuario_id=?")
      .run(accessToken, refreshToken, expira, usuarioId);
  }
  borrar(usuarioId: string): void {
    getDb().prepare("DELETE FROM ms_conexiones WHERE usuario_id=?").run(usuarioId);
  }
}
```

Regístralo en `src/repos/index.ts` (`ms: new MsConexionesRepoSqlite()`).

## El conector — da un access token fresco para Graph

OJO diferencia con Google: Microsoft **rota** el refresh token en cada renovación → hay que **guardar el
nuevo** que venga en la respuesta.

```ts
// src/microsoft/connector.ts
import { repos } from "../repos/index.js";

const tokenUrl = () =>
  `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT ?? "common"}/oauth2/v2.0/token`;

/** Access token válido para Graph, renovándolo si caducó. null si el usuario no ha conectado Microsoft. */
export async function graphTokenDe(usuarioId: string): Promise<string | null> {
  const con = repos.ms.obtener(usuarioId);
  if (!con) return null;
  if (con.accessToken && con.expira && con.expira > Date.now() + 60_000) return con.accessToken;

  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: con.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`No se pudo renovar el token de Microsoft (${res.status})`);
  const t = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const expira = Date.now() + t.expires_in * 1000;
  // Microsoft suele devolver un refresh_token nuevo: guárdalo (si no viene, conserva el anterior).
  repos.ms.actualizarTokens(usuarioId, t.access_token, t.refresh_token ?? con.refreshToken, expira);
  return t.access_token;
}
```

## Rutas de conexión (conectar / desconectar)

```ts
// src/microsoft/routes.ts
import type { FastifyInstance } from "fastify";
import { repos } from "../repos/index.js";

const tenant = () => process.env.MICROSOFT_TENANT ?? "common";
const AUTH = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`;
const TOKEN = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;

// Los scopes que pide ESTA app (ajusta a lo que uses). offline_access es OBLIGATORIO para el refresh token.
const SCOPES = ["offline_access", "User.Read", "Files.ReadWrite", "Mail.Send"];

export function registrarMicrosoftRoutes(app: FastifyInstance): void {
  app.get("/api/microsoft/conectar", async (req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
      response_type: "code",
      response_mode: "query",
      scope: SCOPES.join(" "),
      state: req.usuario!.userId,
    });
    return reply.redirect(`${AUTH()}?${params}`);
  });

  // Callback — público (Microsoft no manda nuestra cookie); el usuario va en `state`
  app.get("/api/microsoft/callback", { config: { publico: true } }, async (req, reply) => {
    const { code, state: usuarioId, error } = req.query as Record<string, string>;
    if (error || !code || !usuarioId) {
      return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?microsoft=error`);
    }
    const res = await fetch(TOKEN(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!res.ok) return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?microsoft=error`);
    const t = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    if (!t.refresh_token) return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?microsoft=sin_refresh`);

    repos.ms.guardar({
      usuarioId, refreshToken: t.refresh_token, accessToken: t.access_token,
      expira: Date.now() + t.expires_in * 1000, scopes: SCOPES.join(" "), emailMs: null,
    });
    return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?microsoft=ok`);
  });

  app.get("/api/microsoft/estado", async (req, reply) => {
    reply.send({ conectado: !!repos.ms.obtener(req.usuario!.userId) });
  });

  app.post("/api/microsoft/desconectar", async (req, reply) => {
    repos.ms.borrar(req.usuario!.userId);
    reply.send({ ok: true });
  });
}
```

Registra `registrarMicrosoftRoutes(app)` en `src/server.ts` (después del guard).

## Clientes finos (todos contra Microsoft Graph con `fetch`)

```ts
// src/microsoft/graph.ts — helper común: una llamada a Graph con el token del usuario
import { graphTokenDe } from "./connector.js";
const BASE = "https://graph.microsoft.com/v1.0";

export async function graph<T = any>(
  usuarioId: string, ruta: string, init: RequestInit = {},
): Promise<T> {
  const token = await graphTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Microsoft");
  const r = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Graph ${r.status} en ${ruta}: ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : (await r.json()) as T;
}
```

```ts
// src/microsoft/onedrive.ts — subir un fichero a OneDrive (≤4 MB: PUT directo)
import { graphTokenDe } from "./connector.js";

export async function subirAOneDrive(usuarioId: string, ruta: string, mime: string, datos: Buffer): Promise<string> {
  const token = await graphTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Microsoft");
  // ruta p.ej. "Informes/abril.pdf" → la crea bajo la raíz de OneDrive del usuario
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(ruta)}:/content`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": mime }, body: datos });
  if (!r.ok) throw new Error(`OneDrive ${r.status}: ${await r.text()}`);
  return (await r.json() as { id: string }).id; // para >4 MB usa una "upload session"
}
```

```ts
// src/microsoft/outlook.ts — enviar correo como el usuario
import { graph } from "./graph.js";

export async function enviarOutlook(usuarioId: string, para: string, asunto: string, cuerpo: string): Promise<void> {
  await graph(usuarioId, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: "Text", content: cuerpo },
        toRecipients: [{ emailAddress: { address: para } }],
      },
      saveToSentItems: true,
    }),
  });
}
```

```ts
// src/microsoft/calendar.ts — crear un evento
import { graph } from "./graph.js";

export async function crearEventoMs(
  usuarioId: string, ev: { titulo: string; inicio: string; fin: string; zona?: string },
): Promise<string> {
  const r = await graph<{ id: string }>(usuarioId, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: ev.titulo,
      start: { dateTime: ev.inicio, timeZone: ev.zona ?? "Romance Standard Time" }, // dateTime ISO sin zona, p.ej. 2026-07-01T10:00:00
      end: { dateTime: ev.fin, timeZone: ev.zona ?? "Romance Standard Time" },
    }),
  });
  return r.id;
}
```

```ts
// src/microsoft/contacts.ts — listar y crear contactos
import { graph } from "./graph.js";

export async function listarContactosMs(usuarioId: string): Promise<{ nombre: string; email?: string }[]> {
  const r = await graph<{ value: any[] }>(usuarioId, "/me/contacts?$top=200&$select=displayName,emailAddresses");
  return r.value.map((c) => ({ nombre: c.displayName, email: c.emailAddresses?.[0]?.address }));
}

export async function crearContactoMs(usuarioId: string, nombre: string, email?: string): Promise<string> {
  const r = await graph<{ id: string }>(usuarioId, "/me/contacts", {
    method: "POST",
    body: JSON.stringify({ displayName: nombre, emailAddresses: email ? [{ address: email, name: nombre }] : [] }),
  });
  return r.id;
}
```

```ts
// src/microsoft/todo.ts — tareas de Microsoft To Do
import { graph } from "./graph.js";

/** Lista las listas de tareas; usa el id de una para crear/leer tareas dentro. */
export async function listasTareasMs(usuarioId: string): Promise<{ id: string; nombre: string }[]> {
  const r = await graph<{ value: any[] }>(usuarioId, "/me/todo/lists");
  return r.value.map((l) => ({ id: l.id, nombre: l.displayName }));
}

export async function crearTareaMs(usuarioId: string, listaId: string, titulo: string, vence?: string): Promise<string> {
  const r = await graph<{ id: string }>(usuarioId, `/me/todo/lists/${listaId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: titulo,
      dueDateTime: vence ? { dateTime: vence, timeZone: "UTC" } : undefined, // vence ISO, p.ej. 2026-07-01T00:00:00
    }),
  });
  return r.id;
}
```

```ts
// src/microsoft/teams.ts — publicar en un canal de Teams (necesita ChannelMessage.Send)
import { graph } from "./graph.js";

export async function misEquipos(usuarioId: string): Promise<{ id: string; nombre: string }[]> {
  const r = await graph<{ value: any[] }>(usuarioId, "/me/joinedTeams");
  return r.value.map((t) => ({ id: t.id, nombre: t.displayName }));
}

export async function publicarEnCanal(usuarioId: string, equipoId: string, canalId: string, texto: string): Promise<void> {
  await graph(usuarioId, `/teams/${equipoId}/channels/${canalId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: { contentType: "html", content: texto } }),
  });
}
```

## UI — botón "Conectar con Microsoft" (en Ajustes)

```ts
function conectarMicrosoft() { window.location.href = "/api/microsoft/conectar"; }
const { conectado } = await fetch("/api/microsoft/estado").then((r) => r.json());
```

Muestra "Conectado" + botón "Desconectar" cuando `conectado`, o "Conectar con Microsoft" si no.

## Reglas

- **`offline_access` SIEMPRE** entre los scopes, o no recibirás refresh token (y el acceso caduca en 1 h).
- **Guarda el refresh token nuevo** en cada renovación (Microsoft lo rota; el connector de arriba ya lo hace).
- **Pide los scopes mínimos**; algunos (Teams, `Mail.Read` de todo el buzón) pueden requerir consentimiento
  del **administrador** del tenant del cliente — avísalo.
- El **refresh token** vive en la BD del servidor, NUNCA en el navegador. Cífralo en reposo en producción.
- Maneja el **token revocado/caducado** (90 días sin uso): si Graph da 401, borra la conexión y pide reconectar.
- Esto NO es el login (`library/auth/auth-microsoft-entra.md`): el usuario entra primero y LUEGO conecta servicios.

Relacionado: login Microsoft `library/auth/auth-microsoft-entra.md`; equivalente Google
`library/integraciones/google-workspace.md`; correo sin cuenta del usuario (SMTP propio)
`library/integraciones/email-transaccional.md`; persistencia/repos `library/arquitectura/repository.md`.
