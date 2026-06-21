# Log de auditoría — quién hizo qué y cuándo

**Categoría:** seguridad | **Cuándo usar:** Apps con requisitos de cumplimiento (GDPR, ISO 27001, sector salud, finanzas), documentos privados, o cualquier sistema donde sea importante saber quién accedió a qué.

## Esquema BD

```typescript
// db/schema.ts
export const auditLog = pgTable("audit_log", {
  id:         text("id").primaryKey(),
  usuarioId:  text("usuario_id"),                        // null si acción anónima
  accion:     text("accion").notNull(),                  // "documento.descargar", "usuario.login", etc.
  recurso:    text("recurso").notNull(),                 // "documento", "usuario", "proyecto"
  recursoId:  text("recurso_id"),                        // ID del recurso afectado (si aplica)
  resultado:  text("resultado", { enum: ["ok", "error", "denegado"] }).notNull(),
  ip:         text("ip"),
  userAgent:  text("user_agent"),
  metadata:   text("metadata"),                          // JSON con detalles adicionales
  creadoEn:   timestamp("creado_en").notNull().defaultNow(),
});

// Índices para consultas frecuentes
// CREATE INDEX ON audit_log (usuario_id, creado_en DESC);
// CREATE INDEX ON audit_log (recurso, recurso_id, creado_en DESC);
// CREATE INDEX ON audit_log (accion, creado_en DESC);
```

## Helper de registro

```typescript
// security/audit.ts
import { ulid } from "ulid";
import { db, schema } from "../db/client.js";
import type { FastifyRequest } from "fastify";

export interface AuditEvent {
  usuarioId?:  string;
  accion:      string;        // formato "recurso.verbo" — e.g. "documento.descargar"
  recurso:     string;
  recursoId?:  string;
  resultado:   "ok" | "error" | "denegado";
  req?:        FastifyRequest;
  metadata?:   Record<string, unknown>;
}

export async function audit(event: AuditEvent): Promise<void> {
  await db().insert(schema.auditLog).values({
    id:        ulid().toLowerCase(),
    usuarioId: event.usuarioId ?? null,
    accion:    event.accion,
    recurso:   event.recurso,
    recursoId: event.recursoId ?? null,
    resultado: event.resultado,
    ip:        event.req ? getIp(event.req) : null,
    userAgent: event.req?.headers["user-agent"]?.slice(0, 200) ?? null,
    metadata:  event.metadata ? JSON.stringify(event.metadata) : null,
    creadoEn:  new Date(),
  });
}

function getIp(req: FastifyRequest): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip
  );
}
```

## Uso desde rutas y handlers

```typescript
// En una ruta de descarga de documento:
app.get("/api/documentos/:id/descargar", { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const doc = await documentoRepo.findById(id);

  if (!doc) {
    await audit({ accion: "documento.descargar", recurso: "documento", recursoId: id,
      resultado: "error", usuarioId: req.user.userId, req,
      metadata: { motivo: "no encontrado" } });
    return reply.code(404).send({ error: "No encontrado" });
  }

  if (!puedeAcceder(req.user, doc)) {
    await audit({ accion: "documento.descargar", recurso: "documento", recursoId: id,
      resultado: "denegado", usuarioId: req.user.userId, req,
      metadata: { propietario: doc.usuarioId } });
    return reply.code(403).send({ error: "Sin permisos" });
  }

  await audit({ accion: "documento.descargar", recurso: "documento", recursoId: id,
    resultado: "ok", usuarioId: req.user.userId, req });

  // ... enviar el fichero
});
```

## Auditoría automática via hook de Fastify

```typescript
// Para auditar todas las rutas de escritura sin repetir código:
app.addHook("onResponse", async (req, reply) => {
  // Solo auditar métodos de escritura
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  // Solo rutas de la API
  if (!req.url.startsWith("/api/")) return;
  // No auditar rutas de auth (ya se auditan explícitamente)
  if (req.url.startsWith("/api/auth/")) return;

  const resultado = reply.statusCode < 400 ? "ok"
    : reply.statusCode === 403          ? "denegado"
    : "error";

  await audit({
    accion:    `${req.method.toLowerCase()}.${req.url.split("/")[2] ?? "desconocido"}`,
    recurso:   req.url.split("/")[2] ?? "desconocido",
    recursoId: (req.params as any)?.id,
    resultado,
    usuarioId: (req as any).user?.userId,
    req,
    metadata:  { status: reply.statusCode, url: req.url },
  });
});
```

## Integración con Domain Events (auditoría asíncrona)

```typescript
// events/audit-listener.ts — escuchar eventos de dominio y registrarlos
import { eventBus } from "./event-bus.js";
import { audit } from "../security/audit.js";

eventBus.on("DocumentoSubido", (data) => {
  audit({ accion: "documento.subir", recurso: "documento", recursoId: data.documentoId,
    resultado: "ok", usuarioId: data.usuarioId, metadata: { nombre: data.nombre, tamano: data.tamano } });
});

eventBus.on("UsuarioBloqueado", (data) => {
  audit({ accion: "usuario.bloquear", recurso: "usuario", recursoId: data.usuarioId,
    resultado: "ok", usuarioId: data.adminId, metadata: { motivo: data.motivo } });
});
```

## Query — consultar el audit log (con paginación)

```typescript
// routes/audit.ts
import { desc, eq, and, gte, lte, like } from "drizzle-orm";

app.get("/api/admin/audit", {
  preHandler: [requireAuth, requireRole("admin")],
}, async (req) => {
  const {
    usuarioId, recurso, accion, resultado,
    desde, hasta,
    pagina = "1", limite = "50",
  } = req.query as Record<string, string>;

  const pag = Math.max(1, parseInt(pagina));
  const lim = Math.min(100, parseInt(limite));

  const condiciones = [
    usuarioId ? eq(schema.auditLog.usuarioId, usuarioId) : undefined,
    recurso   ? eq(schema.auditLog.recurso, recurso)     : undefined,
    accion    ? like(schema.auditLog.accion, `%${accion}%`) : undefined,
    resultado ? eq(schema.auditLog.resultado, resultado as any) : undefined,
    desde     ? gte(schema.auditLog.creadoEn, new Date(desde)) : undefined,
    hasta     ? lte(schema.auditLog.creadoEn, new Date(hasta)) : undefined,
  ].filter(Boolean);

  const [total, items] = await Promise.all([
    db().select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLog).where(and(...condiciones)),
    db().select().from(schema.auditLog)
      .where(and(...condiciones))
      .orderBy(desc(schema.auditLog.creadoEn))
      .limit(lim).offset((pag - 1) * lim),
  ]);

  return { total: total[0].count, pagina: pag, limite: lim, items };
});
```

## Retención — purgar eventos antiguos

```typescript
// script o cron job: eliminar audit_log de más de 2 años
import { lt } from "drizzle-orm";

async function purgarAuditLog(dias = 730) {
  const limite = new Date();
  limite.setDate(limite.getDate() - dias);

  const { rowCount } = await db().delete(schema.auditLog)
    .where(lt(schema.auditLog.creadoEn, limite));

  console.log(`Audit log: ${rowCount} registros purgados (anteriores a ${limite.toISOString()})`);
}
```

## Convención de nombres de acciones

```
recurso.verbo

documento.subir       documento.descargar   documento.eliminar   documento.compartir
usuario.login         usuario.logout        usuario.registro     usuario.bloquear
proyecto.crear        proyecto.editar       proyecto.archivar
admin.exportar        admin.importar        admin.purgar
```
