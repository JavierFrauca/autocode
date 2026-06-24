# Flujos de aprobación / máquina de estados

**Categoría:** arquitectura | **Cuándo usar:** cuando una entidad recorre estados con reglas: una solicitud
de vacaciones, un pedido, un gasto, un parte… pasa por `borrador → enviado → aprobado/rechazado`, y **quién**
puede hacer cada paso depende del rol. Evita el caos de meter `if estado === "x"` por todo el código.

**Idea:** declaras el flujo (estados + transiciones permitidas + qué rol puede cada transición) en UN sitio;
un motor valida y aplica los cambios y deja un **historial** de quién movió qué y cuándo. Cero dependencias.

## 1. Definir el flujo (un objeto, la única fuente de verdad)

```ts
// src/dominio/flujo-solicitud.ts
import type { Rol } from "../auth/guard.js";

export type EstadoSolicitud = "borrador" | "enviada" | "aprobada" | "rechazada";

export interface Transicion<E extends string> {
  accion: string;        // verbo de la UI: "enviar", "aprobar"…
  de: E;                 // estado de origen
  a: E;                  // estado destino
  roles: Rol[];          // quién puede hacerla
  exigeComentario?: boolean;
}

export const flujoSolicitud = {
  inicial: "borrador" as EstadoSolicitud,
  transiciones: [
    { accion: "enviar",   de: "borrador", a: "enviada",   roles: ["usuario", "gestor", "admin"] },
    { accion: "aprobar",  de: "enviada",  a: "aprobada",  roles: ["gestor", "admin"] },
    { accion: "rechazar", de: "enviada",  a: "rechazada", roles: ["gestor", "admin"], exigeComentario: true },
    { accion: "reabrir",  de: "rechazada", a: "borrador", roles: ["usuario", "gestor", "admin"] },
  ] satisfies Transicion<EstadoSolicitud>[],
};
```

## 2. El motor (genérico, reutilizable para cualquier flujo)

```ts
// src/dominio/flujo.ts
export interface Flujo<E extends string> {
  inicial: E;
  transiciones: { accion: string; de: E; a: E; roles: string[]; exigeComentario?: boolean }[];
}

/** Transiciones que un rol puede hacer DESDE el estado actual (para pintar botones). */
export function accionesPosibles<E extends string>(flujo: Flujo<E>, estado: E, rol: string) {
  return flujo.transiciones.filter((t) => t.de === estado && t.roles.includes(rol));
}

/** Valida y devuelve el estado destino, o lanza un error con motivo claro. */
export function resolverTransicion<E extends string>(
  flujo: Flujo<E>, estado: E, accion: string, rol: string, comentario?: string,
): E {
  const t = flujo.transiciones.find((x) => x.de === estado && x.accion === accion);
  if (!t) throw new Error(`No se puede '${accion}' desde '${estado}'`);
  if (!t.roles.includes(rol)) throw new Error("Sin permiso para esta acción");
  if (t.exigeComentario && !comentario?.trim()) throw new Error("Esta acción exige un comentario");
  return t.a;
}
```

## 3. Historial de transiciones (tabla + repo, como el resto)

En `initDb` (`src/db.ts`):

```sql
CREATE TABLE IF NOT EXISTS transiciones (
  id         TEXT PRIMARY KEY,
  entidad    TEXT NOT NULL,        -- "solicitud", "pedido"…
  entidad_id TEXT NOT NULL,
  de         TEXT,
  a          TEXT NOT NULL,
  accion     TEXT NOT NULL,
  usuario_id TEXT NOT NULL,
  comentario TEXT,
  creado     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transiciones_entidad ON transiciones (entidad, entidad_id, creado);
```

```ts
// src/repos/transiciones.repo.ts
import { getDb } from "../db.js";
export interface Transicion { id: string; entidad: string; entidadId: string; de: string | null;
  a: string; accion: string; usuarioId: string; comentario: string | null; creado: string; }

export interface TransicionesRepo {
  registrar(t: Omit<Transicion, "creado">): void;
  historial(entidad: string, entidadId: string): Transicion[];
}
export class TransicionesRepoSqlite implements TransicionesRepo {
  registrar(t: Omit<Transicion, "creado">): void {
    getDb().prepare(
      `INSERT INTO transiciones (id, entidad, entidad_id, de, a, accion, usuario_id, comentario, creado)
       VALUES (@id, @entidad, @entidadId, @de, @a, @accion, @usuarioId, @comentario, @creado)`)
      .run({ ...t, creado: new Date().toISOString() });
  }
  historial(entidad: string, entidadId: string): Transicion[] {
    return getDb().prepare(
      `SELECT id, entidad, entidad_id AS entidadId, de, a, accion, usuario_id AS usuarioId, comentario, creado
         FROM transiciones WHERE entidad = ? AND entidad_id = ? ORDER BY creado`).all(entidad, entidadId) as Transicion[];
  }
}
```

Regístralo en `src/repos/index.ts` (`transiciones: new TransicionesRepoSqlite()`).

## 4. Aplicarlo en una ruta (valida rol + cambia estado + historial + auditoría)

```ts
import { randomUUID } from "node:crypto";
import { resolverTransicion } from "../dominio/flujo.js";
import { flujoSolicitud } from "../dominio/flujo-solicitud.js";
import { repos } from "../repos/index.js";
import { auditar } from "../audit.js";

app.post("/api/solicitudes/:id/:accion", async (req, reply) => {
  const { id, accion } = req.params as { id: string; accion: string };
  const { comentario } = (req.body ?? {}) as { comentario?: string };
  const sol = repos.solicitudes.buscar(id);
  if (!sol) return reply.code(404).send({ error: "No existe" });

  let destino: string;
  try {
    destino = resolverTransicion(flujoSolicitud, sol.estado, accion, req.usuario!.rol, comentario);
  } catch (e) {
    return reply.code(403).send({ error: (e as Error).message });
  }

  repos.solicitudes.cambiarEstado(id, destino);
  repos.transiciones.registrar({
    id: randomUUID(), entidad: "solicitud", entidadId: id, de: sol.estado, a: destino,
    accion, usuarioId: req.usuario!.sub, comentario: comentario ?? null,
  });
  auditar({ accion: `solicitud.${accion}`, recurso: "solicitud", recursoId: id, resultado: "ok", usuarioId: req.usuario!.sub, req });
  return { id, estado: destino };
});
```

## 5. En la pantalla (Vue): badge de estado + solo los botones permitidos

```ts
// el backend te da el estado; pinta acciones con accionesPosibles(flujo, estado, rolDelUsuario)
import { accionesPosibles } from "@/dominio/flujo.js"; // o duplica el helper en el front
const acciones = computed(() => accionesPosibles(flujoSolicitud, sol.value.estado, auth.usuario.rol));
// botón por acción → POST /api/solicitudes/:id/:accion (pide comentario si exigeComentario)
```

Un badge de color por estado (usa los tokens de `library/ui/tema-tokens.md`) y el **historial** debajo
(`repos.transiciones.historial`) como timeline de quién movió qué.

## Reglas

- El flujo se declara en UN objeto; el resto del código pregunta al motor, nunca compara estados a mano.
- La validación de rol es del **servidor** (`resolverTransicion` en la ruta); ocultar botones es solo UX.
- Guarda SIEMPRE el historial: para el usuario no técnico, "¿quién aprobó esto y cuándo?" es oro.
- Es genérico: define un `flujo-<entidad>.ts` por cada entidad con estados; el motor y la tabla se reutilizan.

Relacionado: roles `library/auth/roles-middleware.md`, auditoría `library/seguridad/audit-log.md`,
notificaciones (avisar al aprobador) `library/integraciones/notificaciones-inapp.md`,
eventos de dominio `library/arquitectura/domain-events.md`.
