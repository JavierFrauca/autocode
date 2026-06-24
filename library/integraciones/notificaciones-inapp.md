# Notificaciones in-app (campana + no leídas)

**Categoría:** integraciones | **Cuándo usar:** avisar al usuario DENTRO de la app de cosas que le tocan:
"tienes una solicitud por aprobar", "te han asignado un pedido", "se acerca un vencimiento". Persistentes y
por usuario, a diferencia de los **toasts** (`library/ui/toasts.md`), que son avisos efímeros del momento.

**Idea:** una tabla `notificaciones` por usuario + un helper `notificar(...)` que cualquier parte del backend
llama + una **campana** en la cabecera con el contador de no leídas. Cero dependencias. Empuje en vivo
opcional (websocket); si no, sondeo cada pocos segundos.

## Tabla (en `src/db.ts`, dentro de `initDb`)

```sql
CREATE TABLE IF NOT EXISTS notificaciones (
  id         TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'info',   -- info | exito | aviso | error (para el icono/color)
  titulo     TEXT NOT NULL,
  cuerpo     TEXT,
  enlace     TEXT,                            -- ruta del front a la que lleva al pulsar, p.ej. /solicitudes/123
  leida      INTEGER NOT NULL DEFAULT 0,
  creado     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_usuario ON notificaciones (usuario_id, leida, creado DESC);
```

## Repo (`src/repos/notificaciones.repo.ts`)

```ts
import { getDb } from "../db.js";
export interface Notificacion { id: string; usuarioId: string; tipo: string; titulo: string;
  cuerpo: string | null; enlace: string | null; leida: number; creado: string; }

export interface NotificacionesRepo {
  crear(n: Omit<Notificacion, "leida" | "creado">): void;
  listar(usuarioId: string, limite?: number): Notificacion[];
  contarNoLeidas(usuarioId: string): number;
  marcarLeida(id: string, usuarioId: string): void;
  marcarTodas(usuarioId: string): void;
}

export class NotificacionesRepoSqlite implements NotificacionesRepo {
  crear(n: Omit<Notificacion, "leida" | "creado">): void {
    getDb().prepare(
      `INSERT INTO notificaciones (id, usuario_id, tipo, titulo, cuerpo, enlace, leida, creado)
       VALUES (@id, @usuarioId, @tipo, @titulo, @cuerpo, @enlace, 0, @creado)`)
      .run({ ...n, creado: new Date().toISOString() });
  }
  listar(usuarioId: string, limite = 50): Notificacion[] {
    return getDb().prepare(
      `SELECT id, usuario_id AS usuarioId, tipo, titulo, cuerpo, enlace, leida, creado
         FROM notificaciones WHERE usuario_id = ? ORDER BY creado DESC LIMIT ?`).all(usuarioId, limite) as Notificacion[];
  }
  contarNoLeidas(usuarioId: string): number {
    return (getDb().prepare("SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0")
      .get(usuarioId) as { n: number }).n;
  }
  marcarLeida(id: string, usuarioId: string): void {
    getDb().prepare("UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?").run(id, usuarioId);
  }
  marcarTodas(usuarioId: string): void {
    getDb().prepare("UPDATE notificaciones SET leida = 1 WHERE usuario_id = ?").run(usuarioId);
  }
}
```

Regístralo en `src/repos/index.ts` (`notificaciones: new NotificacionesRepoSqlite()`).

## Helper para emitir desde cualquier parte del backend (`src/notificar.ts`)

```ts
import { randomUUID } from "node:crypto";
import { repos } from "./repos/index.js";

export function notificar(usuarioId: string, n: {
  titulo: string; cuerpo?: string; enlace?: string; tipo?: "info" | "exito" | "aviso" | "error";
}): void {
  repos.notificaciones.crear({
    id: randomUUID(), usuarioId, tipo: n.tipo ?? "info",
    titulo: n.titulo, cuerpo: n.cuerpo ?? null, enlace: n.enlace ?? null,
  });
  // Empuje en vivo opcional: si tienes websocket, avisa a ese usuario aquí (ver library/integraciones/websocket.md).
}
```

Ejemplo de uso (al enviar una solicitud, avisar a los aprobadores):

```ts
for (const gestor of repos.usuarios.listarPorRol("gestor")) {
  notificar(gestor.id, { titulo: "Nueva solicitud por aprobar", enlace: `/solicitudes/${id}`, tipo: "aviso" });
}
```

## Rutas (`src/notificaciones-routes.ts`)

```ts
import type { FastifyInstance } from "fastify";
import { repos } from "./repos/index.js";

export function registrarNotificacionesRoutes(app: FastifyInstance): void {
  // Todas son del usuario en sesión (req.usuario lo pone el guard); nadie ve las de otro.
  app.get("/api/notificaciones", async (req) => repos.notificaciones.listar(req.usuario!.sub));
  app.get("/api/notificaciones/no-leidas", async (req) => ({ n: repos.notificaciones.contarNoLeidas(req.usuario!.sub) }));
  app.post("/api/notificaciones/:id/leer", async (req) => {
    repos.notificaciones.marcarLeida((req.params as { id: string }).id, req.usuario!.sub);
    return { ok: true };
  });
  app.post("/api/notificaciones/leer-todas", async (req) => {
    repos.notificaciones.marcarTodas(req.usuario!.sub);
    return { ok: true };
  });
}
```

Registra `registrarNotificacionesRoutes(app)` en `src/server.ts`.

## Campana en la cabecera (Vue)

Un store que sondea el contador y carga la lista al abrir:

```ts
// web/src/stores/notificaciones.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../lib/api.js";

export const useNotificaciones = defineStore("notificaciones", () => {
  const noLeidas = ref(0);
  const lista = ref<any[]>([]);

  async function refrescarContador() { noLeidas.value = (await api.get("/api/notificaciones/no-leidas")).n; }
  async function cargar() { lista.value = await api.get("/api/notificaciones"); }
  async function leer(id: string) { await api.post(`/api/notificaciones/${id}/leer`); await Promise.all([cargar(), refrescarContador()]); }
  async function leerTodas() { await api.post("/api/notificaciones/leer-todas"); await Promise.all([cargar(), refrescarContador()]); }

  // Sondeo cada 20 s (sustitúyelo por websocket si lo tienes).
  setInterval(refrescarContador, 20_000);
  return { noLeidas, lista, refrescarContador, cargar, leer, leerTodas };
});
```

En `App.vue` (cabecera, junto al usuario): un botón con icono de campana + `<span v-if="noLeidas">{{ noLeidas }}</span>`
que abre un desplegable con `lista` (icono/color por `tipo`, `router.push(n.enlace)` + `leer(n.id)` al pulsar,
y un "marcar todas como leídas").

## Reglas

- Cada usuario SOLO ve y marca las suyas: filtra SIEMPRE por `req.usuario!.sub` en el servidor (no te fíes del id que mande el front).
- No confundas con toasts: el toast es el "ya guardado ✓" del momento; la notificación persiste hasta que la lee.
- Para volumen alto, pagina (`LIMIT`) y purga las leídas antiguas con una tarea programada (`library/integraciones/tareas-programadas.md`).
- Empuje en vivo: con websocket evitas el sondeo; el sondeo de 20 s es el fallback que funciona siempre.

Relacionado: toasts `library/ui/toasts.md`, websocket `library/integraciones/websocket.md`,
tareas programadas `library/integraciones/tareas-programadas.md`, flujos de estado `library/arquitectura/flujos-estado.md`.
