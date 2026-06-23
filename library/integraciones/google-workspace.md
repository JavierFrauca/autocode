# Servicios de Google (Drive, Gmail, Calendar, Sheets)

**Categoría:** integraciones | **Cuándo usar:** la app necesita LEER o ESCRIBIR en la cuenta de Google de
cada usuario: subir/leer ficheros en **Drive**, enviar/leer correo por **Gmail**, crear eventos en
**Calendar**, leer/escribir hojas de **Sheets** (y por el mismo patrón: Contacts, Tasks…).

Esto es DISTINTO de:
- **Login con Google** (`library/auth/auth-google-oauth.md`): solo identifica al usuario (`openid email profile`).
- **Mapas** (`library/integraciones/google-maps.md`): clave de API, no la cuenta del usuario.

Aquí el usuario **autoriza** a la app a actuar EN SU NOMBRE sobre ciertos datos (scopes), y la app guarda
un **refresh token** para seguir teniendo acceso sin volver a pedir permiso. **Cero dependencias npm**: se
llama a las APIs REST de Google con `fetch` (no hace falta el paquete `googleapis`, que es enorme).

## Pieza preparada — la idea

1. **Conexión** (`GoogleConnector`): una vez conectada la cuenta, devuelve un *access token* fresco para
   ese usuario (lo renueva solo con el refresh token cuando caduca). Es el ÚNICO punto que toca OAuth.
2. **Clientes finos**: Drive/Gmail/Calendar/Sheets son módulos pequeños que piden el token al connector y
   llaman al endpoint REST correspondiente. Añadir otro servicio = otro módulo de ~20 líneas.

## Configuración en Google Cloud (decírselo en lenguaje llano)

1. `console.cloud.google.com` → proyecto → **APIs y servicios → Biblioteca**: activar las APIs que use la
   app (*Google Drive API*, *Gmail API*, *Google Calendar API*, *Google Sheets API*).
2. **Pantalla de consentimiento OAuth**: tipo *Externo* (o *Interno* si es Google Workspace de la empresa),
   añadir los **scopes** que la app pide (ver abajo) y, en producción, **verificar la app** con Google
   (los scopes "sensibles" lo exigen; en pruebas basta añadir *usuarios de prueba*).
3. **Credenciales → ID de cliente OAuth 2.0 → Aplicación web**. URI de redirección:
   `http://localhost:3000/api/google/callback` (dev) + la de producción.

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
FRONTEND_URL=http://localhost:5173
```

### Scopes por servicio (pide SOLO lo que uses — menos fricción y menos revisión de Google)

| Servicio | Scope típico | Para qué |
|----------|--------------|----------|
| Drive (solo lo creado por la app) | `https://www.googleapis.com/auth/drive.file` | subir/leer ficheros que crea la app (recomendado, no es "sensible") |
| Drive (todo) | `https://www.googleapis.com/auth/drive` | acceso total (sensible, revisión Google) |
| Gmail enviar | `https://www.googleapis.com/auth/gmail.send` | enviar correo como el usuario |
| Gmail leer | `https://www.googleapis.com/auth/gmail.readonly` | leer correo (sensible) |
| Calendar | `https://www.googleapis.com/auth/calendar` | crear/editar eventos |
| Sheets | `https://www.googleapis.com/auth/spreadsheets` | leer/escribir hojas |
| Contacts (People API) | `https://www.googleapis.com/auth/contacts` | leer/crear contactos (`...contacts.readonly` solo lectura) |
| Tasks | `https://www.googleapis.com/auth/tasks` | leer/crear tareas (`...tasks.readonly` solo lectura) |

## Almacén del token por usuario (repo, igual que el resto del andamiaje)

Una tabla nueva + su repositorio (patrón Repository, como `items.repo.ts`). Añade a `initDb` en `src/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS google_conexiones (
  usuario_id    TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  access_token  TEXT,
  expira        INTEGER,            -- epoch ms en que caduca el access_token
  scopes        TEXT NOT NULL,      -- separados por espacio
  email_google  TEXT,
  creado        TEXT NOT NULL
);
```

```ts
// src/repos/google-conexiones.repo.ts
import { getDb } from "../db.js";

export interface GoogleConexion {
  usuarioId: string; refreshToken: string; accessToken: string | null;
  expira: number | null; scopes: string; emailGoogle: string | null;
}

export interface GoogleConexionesRepo {
  obtener(usuarioId: string): GoogleConexion | null;
  guardar(c: GoogleConexion): void;
  actualizarAccess(usuarioId: string, accessToken: string, expira: number): void;
  borrar(usuarioId: string): void;
}

export class GoogleConexionesRepoSqlite implements GoogleConexionesRepo {
  obtener(usuarioId: string): GoogleConexion | null {
    const r = getDb().prepare(
      `SELECT usuario_id as usuarioId, refresh_token as refreshToken, access_token as accessToken,
              expira, scopes, email_google as emailGoogle
         FROM google_conexiones WHERE usuario_id = ?`).get(usuarioId) as GoogleConexion | undefined;
    return r ?? null;
  }
  guardar(c: GoogleConexion): void {
    getDb().prepare(
      `INSERT INTO google_conexiones (usuario_id, refresh_token, access_token, expira, scopes, email_google, creado)
       VALUES (@usuarioId, @refreshToken, @accessToken, @expira, @scopes, @emailGoogle, @creado)
       ON CONFLICT(usuario_id) DO UPDATE SET
         refresh_token=excluded.refresh_token, access_token=excluded.access_token,
         expira=excluded.expira, scopes=excluded.scopes, email_google=excluded.email_google`)
      .run({ ...c, creado: new Date().toISOString() });
  }
  actualizarAccess(usuarioId: string, accessToken: string, expira: number): void {
    getDb().prepare("UPDATE google_conexiones SET access_token=?, expira=? WHERE usuario_id=?")
      .run(accessToken, expira, usuarioId);
  }
  borrar(usuarioId: string): void {
    getDb().prepare("DELETE FROM google_conexiones WHERE usuario_id=?").run(usuarioId);
  }
}
```

Regístralo en `src/repos/index.ts` (`google: new GoogleConexionesRepoSqlite()`).

## El conector — da un access token fresco

```ts
// src/google/connector.ts
import { repos } from "../repos/index.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Devuelve un access token válido para ese usuario, renovándolo si caducó. null si no ha conectado Google. */
export async function accessTokenDe(usuarioId: string): Promise<string | null> {
  const con = repos.google.obtener(usuarioId);
  if (!con) return null;

  if (con.accessToken && con.expira && con.expira > Date.now() + 60_000) return con.accessToken;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: con.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`No se pudo renovar el token de Google (${res.status})`);
  const t = await res.json() as { access_token: string; expires_in: number };
  const expira = Date.now() + t.expires_in * 1000;
  repos.google.actualizarAccess(usuarioId, t.access_token, expira);
  return t.access_token;
}
```

## Rutas de conexión (conectar / desconectar)

```ts
// src/google/routes.ts
import type { FastifyInstance } from "fastify";
import { repos } from "../repos/index.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Los scopes que pide ESTA app (ajusta a lo que uses):
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

export function registrarGoogleRoutes(app: FastifyInstance): void {
  // Iniciar conexión (usuario ya logueado en la app → req.usuario lo pone el guard)
  app.get("/api/google/conectar", async (req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",   // imprescindible para recibir refresh_token
      prompt: "consent",        // fuerza el refresh_token aunque ya hubiera consentido antes
      state: req.usuario!.userId,
    });
    return reply.redirect(`${AUTH_URL}?${params}`);
  });

  // Callback de Google — público (Google no manda nuestra cookie); el usuario va en `state`
  app.get("/api/google/callback", { config: { publico: true } }, async (req, reply) => {
    const { code, state: usuarioId, error } = req.query as Record<string, string>;
    if (error || !code || !usuarioId) {
      return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?google=error`);
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?google=error`);
    const t = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };

    // Si Google no manda refresh_token (ya consentido antes), conserva el guardado
    const previo = repos.google.obtener(usuarioId);
    const refresh = t.refresh_token ?? previo?.refreshToken;
    if (!refresh) return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?google=sin_refresh`);

    repos.google.guardar({
      usuarioId, refreshToken: refresh, accessToken: t.access_token,
      expira: Date.now() + t.expires_in * 1000, scopes: SCOPES.join(" "), emailGoogle: previo?.emailGoogle ?? null,
    });
    return reply.redirect(`${process.env.FRONTEND_URL}/ajustes?google=ok`);
  });

  app.get("/api/google/estado", async (req, reply) => {
    reply.send({ conectado: !!repos.google.obtener(req.usuario!.userId) });
  });

  app.post("/api/google/desconectar", async (req, reply) => {
    repos.google.borrar(req.usuario!.userId);
    reply.send({ ok: true });
  });
}
```

Registra `registrarGoogleRoutes(app)` en `src/server.ts` (después del guard, como las demás rutas).

## Clientes finos (REST con `fetch`)

```ts
// src/google/drive.ts — subir un fichero a Drive (multipart)
import { accessTokenDe } from "./connector.js";

export async function subirADrive(usuarioId: string, nombre: string, mime: string, datos: Buffer): Promise<string> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const limite = "lim" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: nombre });
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: ${mime}\r\n\r\n`), datos, Buffer.from(`\r\n--${limite}--`),
  ]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
  if (!r.ok) throw new Error(`Drive ${r.status}: ${await r.text()}`);
  return (await r.json() as { id: string }).id;
}
```

```ts
// src/google/gmail.ts — enviar un correo como el usuario
import { accessTokenDe } from "./connector.js";

export async function enviarGmail(usuarioId: string, para: string, asunto: string, cuerpo: string): Promise<void> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const mime =
    `To: ${para}\r\nSubject: =?UTF-8?B?${Buffer.from(asunto).toString("base64")}?=\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n${cuerpo}`;
  const raw = Buffer.from(mime).toString("base64url");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
}
```

```ts
// src/google/calendar.ts — crear un evento
import { accessTokenDe } from "./connector.js";

export async function crearEvento(
  usuarioId: string, ev: { titulo: string; inicio: string; fin: string; descripcion?: string },
): Promise<string> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.titulo, description: ev.descripcion,
      start: { dateTime: ev.inicio }, end: { dateTime: ev.fin },   // ISO con zona, p.ej. 2026-07-01T10:00:00+02:00
    }),
  });
  if (!r.ok) throw new Error(`Calendar ${r.status}: ${await r.text()}`);
  return (await r.json() as { id: string }).id;
}
```

```ts
// src/google/sheets.ts — leer y añadir filas
import { accessTokenDe } from "./connector.js";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export async function leerHoja(usuarioId: string, hojaId: string, rango: string): Promise<string[][]> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(`${API}/${hojaId}/values/${encodeURIComponent(rango)}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${await r.text()}`);
  return (await r.json() as { values?: string[][] }).values ?? [];
}

export async function anadirFilas(usuarioId: string, hojaId: string, rango: string, filas: string[][]): Promise<void> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(
    `${API}/${hojaId}/values/${encodeURIComponent(rango)}:append?valueInputOption=USER_ENTERED`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: filas }) });
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${await r.text()}`);
}
```

```ts
// src/google/contacts.ts — listar y crear contactos (People API)
import { accessTokenDe } from "./connector.js";
const API = "https://people.googleapis.com/v1";

export interface Contacto { nombre: string; email?: string; telefono?: string; }

export async function listarContactos(usuarioId: string): Promise<Contacto[]> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(
    `${API}/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`People ${r.status}: ${await r.text()}`);
  const data = await r.json() as { connections?: any[] };
  return (data.connections ?? []).map((p) => ({
    nombre: p.names?.[0]?.displayName ?? "",
    email: p.emailAddresses?.[0]?.value,
    telefono: p.phoneNumbers?.[0]?.value,
  }));
}

export async function crearContacto(usuarioId: string, c: Contacto): Promise<string> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(`${API}/people:createContact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      names: [{ givenName: c.nombre }],
      emailAddresses: c.email ? [{ value: c.email }] : undefined,
      phoneNumbers: c.telefono ? [{ value: c.telefono }] : undefined,
    }),
  });
  if (!r.ok) throw new Error(`People ${r.status}: ${await r.text()}`);
  return (await r.json() as { resourceName: string }).resourceName;
}
```

```ts
// src/google/tasks.ts — listar y crear tareas (Google Tasks API)
import { accessTokenDe } from "./connector.js";
const API = "https://tasks.googleapis.com/tasks/v1";

export interface Tarea { id?: string; titulo: string; notas?: string; vence?: string; hecha?: boolean; }

/** lista = "@default" para la lista principal del usuario. */
export async function listarTareas(usuarioId: string, lista = "@default"): Promise<Tarea[]> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(`${API}/lists/${lista}/tasks?showCompleted=true`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Tasks ${r.status}: ${await r.text()}`);
  const data = await r.json() as { items?: any[] };
  return (data.items ?? []).map((t) => ({
    id: t.id, titulo: t.title, notas: t.notes, vence: t.due, hecha: t.status === "completed",
  }));
}

export async function crearTarea(usuarioId: string, t: Tarea, lista = "@default"): Promise<string> {
  const token = await accessTokenDe(usuarioId);
  if (!token) throw new Error("El usuario no ha conectado Google");
  const r = await fetch(`${API}/lists/${lista}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: t.titulo, notes: t.notas, due: t.vence }), // due en RFC3339, p.ej. 2026-07-01T00:00:00.000Z
  });
  if (!r.ok) throw new Error(`Tasks ${r.status}: ${await r.text()}`);
  return (await r.json() as { id: string }).id;
}
```

## UI — botón "Conectar con Google" (en Ajustes)

```ts
// el botón solo navega a la ruta; la vuelta del callback trae ?google=ok|error
function conectarGoogle() { window.location.href = "/api/google/conectar"; }
const { conectado } = await fetch("/api/google/estado").then((r) => r.json());
```

Muestra "Conectado como {email}" + botón "Desconectar" cuando `conectado`, o "Conectar con Google" si no.

## Reglas

- **Pide los scopes mínimos** (p.ej. `drive.file` en vez de `drive`): menos fricción, evita la revisión
  de Google para scopes sensibles, y es lo correcto en privacidad.
- El **refresh token** es un secreto de larga vida: vive en la BD del servidor, NUNCA llega al navegador.
  Para producción real, cífralo en reposo (la BD ya está protegida, pero un campo cifrado es mejor).
- `access_type=offline` + `prompt=consent` son imprescindibles para recibir el refresh token; si Google
  no lo manda (porque ya consintió antes), conserva el que tengas (lo hace el callback de arriba).
- Maneja el **token revocado**: si una llamada da 401/`invalid_grant`, borra la conexión y pide reconectar.
- Esto NO es el login: el usuario primero entra en la app (login propio o con Google) y LUEGO conecta los
  servicios. Si solo quieres identificar al usuario, usa `library/auth/auth-google-oauth.md`.

Relacionado: login con Google `library/auth/auth-google-oauth.md`; mapas
`library/integraciones/google-maps.md`; correo sin cuenta del usuario (SMTP propio)
`library/integraciones/email-transaccional.md`; persistencia/repos
`library/arquitectura/repository.md`.
