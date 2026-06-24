# Multi-empresa / multi-tenant (aislamiento de datos)

**Categoría:** arquitectura | **Cuándo usar:** una sola instalación que sirve a VARIAS empresas (o
delegaciones/clientes) y los datos de cada una **no deben verse entre sí**. Patrón recurrente en apps de
gestión (lo que `hub_rrhh` hizo a mano). Evita reinventar el aislamiento en cada consulta.

**Idea (tenant por columna):** cada fila de negocio lleva `empresa_id`; el usuario tiene una empresa activa que
viaja en la sesión; **los repos filtran SIEMPRE por esa empresa**. Es el modelo más simple y suficiente para
monoinstancia/SQLite; el día que haga falta separación física, se migra a una BD por empresa sin tocar la lógica.

## 1. Tabla de empresas + columna en usuarios (`src/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS empresas (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  activa INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL
);

-- En la tabla usuarios añade la empresa a la que pertenece (modelo simple: 1 usuario → 1 empresa).
-- empresa_id TEXT  (referencia a empresas.id; el admin global puede tenerla NULL)
```

Y **cada tabla de negocio** lleva `empresa_id TEXT NOT NULL` + índice:

```sql
-- ejemplo
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  empresa_id TEXT NOT NULL,
  -- … campos del dominio …
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa ON pedidos (empresa_id);
```

## 2. La empresa activa viaja en la sesión

Extiende la sesión del andamiaje para llevar `empresaId`. En `src/auth/tokens.ts`:

```ts
export interface Sesion { sub: string; email: string; rol: string; empresaId: string | null; exp: number; }

export function firmarSesion(datos: Pick<Sesion, "sub" | "email" | "rol" | "empresaId">, ttl = TTL_SEGUNDOS): string {
  const payload: Sesion = { ...datos, exp: Math.floor(Date.now() / 1000) + ttl };
  // … igual que antes …
}
```

Y donde se emite la cookie (login local en `src/auth/routes.ts`, y los callbacks de Google/Microsoft si los usas)
añade la empresa del usuario:

```ts
const token = firmarSesion({ sub: u.id, email: u.email, rol: u.rol, empresaId: u.empresaId ?? null });
```

(Amplía `usuarios.repo.ts` para que `buscarPorEmail`/`buscarPorId` devuelvan también `empresa_id AS empresaId`.)

## 3. Repos con scope de empresa — el aislamiento de verdad

El acceso a datos exige SIEMPRE la empresa; no hay método que devuelva filas de todas las empresas.

```ts
// src/repos/pedidos.repo.ts
import { getDb } from "../db.js";
export interface Pedido { id: string; empresaId: string; /* … */ creado: string; }

export interface PedidosRepo {
  listar(empresaId: string): Pedido[];
  buscar(empresaId: string, id: string): Pedido | undefined;
  crear(p: Omit<Pedido, "creado">): void;
}
export class PedidosRepoSqlite implements PedidosRepo {
  listar(empresaId: string): Pedido[] {
    return getDb().prepare("SELECT * FROM pedidos WHERE empresa_id = ? ORDER BY creado DESC").all(empresaId) as Pedido[];
  }
  buscar(empresaId: string, id: string): Pedido | undefined {
    // el empresa_id en el WHERE evita el "acceso por id" a datos de otra empresa
    return getDb().prepare("SELECT * FROM pedidos WHERE empresa_id = ? AND id = ?").get(empresaId, id) as Pedido | undefined;
  }
  crear(p: Omit<Pedido, "creado">): void {
    getDb().prepare("INSERT INTO pedidos (id, empresa_id, creado) VALUES (?, ?, ?)")
      .run(p.id, p.empresaId, new Date().toISOString());
  }
}
```

## 4. En las rutas: toma la empresa de la sesión, nunca del cliente

```ts
// src/empresa.ts
import type { FastifyRequest } from "fastify";
export function empresaActual(req: FastifyRequest): string {
  const id = req.usuario?.empresaId;
  if (!id) throw new Error("El usuario no tiene empresa asignada");
  return id;
}
```

```ts
app.get("/api/pedidos", async (req) => repos.pedidos.listar(empresaActual(req)));
app.get("/api/pedidos/:id", async (req, reply) => {
  const p = repos.pedidos.buscar(empresaActual(req), (req.params as { id: string }).id);
  return p ?? reply.code(404).send({ error: "No existe" }); // 404, no 403: ni confirmas que existe en otra empresa
});
```

> CLAVE: la empresa SIEMPRE sale de `req.usuario` (la sesión firmada), JAMÁS de un parámetro/body que mande el
> navegador. Esa es la frontera de aislamiento.

## 5. Administración

- **Alta de empresa** y **asignar usuarios a empresa**: pantallas de rol `admin` (global). El registro de
  usuarios (`/api/auth/registro`) recibe además `empresaId`.
- El **seed** del andamiaje puede crear una empresa por defecto y asignarle el admin para que "Probar" funcione.

## Extensión: un usuario en VARIAS empresas (con selector)

Si un usuario debe acceder a más de una empresa:

1. Tabla puente `usuarios_empresas (usuario_id, empresa_id, rol)` en vez de `usuarios.empresa_id`.
2. La sesión guarda la **empresa activa** (`empresaId`); empieza en la primera del usuario.
3. Endpoint para cambiarla, que **reemite la cookie** con la nueva empresa (tras comprobar que el usuario
   pertenece a ella):

```ts
app.post("/api/empresa-activa", async (req, reply) => {
  const { empresaId } = req.body as { empresaId: string };
  if (!repos.usuariosEmpresas.pertenece(req.usuario!.sub, empresaId)) return reply.code(403).send({ error: "Sin acceso" });
  const token = firmarSesion({ sub: req.usuario!.sub, email: req.usuario!.email, rol: req.usuario!.rol, empresaId });
  reply.setCookie(COOKIE_SESION, token, cookieOpts);
  return { ok: true, empresaId };
});
```

4. **Selector de empresa** en la cabecera del shell (`App.vue`): un desplegable que llama a ese endpoint y
   recarga. Pinta la empresa activa para que el usuario sepa en cuál está.

## Reglas

- `empresa_id` en TODA tabla de negocio + índice; sin él el aislamiento se cae.
- El filtro de empresa va en el WHERE del repo, no en el servicio ni en el front (no se puede olvidar).
- `buscar(empresaId, id)` con la empresa en el WHERE: así un id de otra empresa devuelve "no existe" (404), sin
  filtrar siquiera su existencia.
- La auditoría (`library/seguridad/audit-log.md`) y las notificaciones también deben respetar la empresa.
- A escala/aislamiento físico: una BD por empresa = nueva impl del repo eligiendo conexión por `empresaId` en el
  composition root (`repos/index.ts`), sin tocar rutas ni servicios (`library/arquitectura/repository.md`).

Relacionado: repository `library/arquitectura/repository.md`, roles `library/auth/roles-middleware.md`,
sesión/login `library/auth/login-system.md`, auditoría `library/seguridad/audit-log.md`.
