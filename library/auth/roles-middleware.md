# Seguridad por defecto — roles y middleware en Fastify

**Categoría:** auth | **Cuándo usar:** Toda app cliente-servidor. Sin excepciones.

## Principio: opt-out, no opt-in

El enfoque **incorrecto** es añadir `preHandler: requireAuth` a cada ruta individualmente. Si el coder se olvida una, ese endpoint queda público sin que nadie se entere.

El enfoque **correcto** es registrar un hook global que bloquea todo por defecto. Las rutas públicas se declaran explícitamente. Si te olvidas de declarar algo como público, falla con 401 — falla seguro.

## Guard global — secure by default

```typescript
// src/adapters/http/auth.guard.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { verificarAccess } from "../../infrastructure/auth/tokens.js";

// Roles disponibles en la app — ampliar según el proyecto
export type Rol = "admin" | "gestor" | "usuario";

declare module "fastify" {
  interface FastifyRequest {
    user: { userId: string; email: string; rol: Rol };
  }
  interface FastifyContextConfig {
    public?: true;           // marca la ruta como pública (sin auth)
    roles?: Rol[];           // roles permitidos (undefined = cualquier autenticado)
  }
}

// Hook global: se registra UNA VEZ en server.ts y protege todo
export async function globalAuthGuard(req: FastifyRequest, reply: FastifyReply) {
  // Rutas marcadas como públicas — pasan sin token
  if (req.routeOptions.config?.public) return;

  // Verificar token
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "No autenticado" });
  }
  try {
    req.user = verificarAccess(header.slice(7)) as any;
  } catch {
    return reply.code(401).send({ error: "Token inválido o expirado" });
  }

  // Si la ruta exige roles concretos, verificar
  const rolesRequeridos = req.routeOptions.config?.roles;
  if (rolesRequeridos?.length && !rolesRequeridos.includes(req.user.rol)) {
    return reply.code(403).send({ error: "Sin permisos suficientes" });
  }
}
```

## Registro en server.ts — una sola línea protege todo

```typescript
// src/server.ts
import { globalAuthGuard } from "./adapters/http/auth.guard.js";

const app = Fastify();

// ─── Seguridad global ────────────────────────────────────────────────────────
// Este hook se ejecuta ANTES de cualquier ruta.
// Para hacer una ruta pública: añadir { config: { public: true } }
// Para restringir a roles: añadir { config: { roles: ["admin"] } }
app.addHook("preHandler", globalAuthGuard);

// ─── Rutas públicas (las únicas excepciones) ─────────────────────────────────
await registerAuthRoutes(app);   // /api/auth/* — todas marcadas como public: true

// ─── Resto de rutas — protegidas automáticamente ─────────────────────────────
await registerPedidoRoutes(app);
await registerUsuarioRoutes(app);
```

## Declaración de seguridad en cada ruta

```typescript
// src/adapters/http/pedidos.routes.ts

// ✅ Cualquier usuario autenticado (rol no restringido)
app.get("/api/pedidos", async (req) => {
  return listarHandler.handle({ usuarioId: req.user.userId });
});

// ✅ Solo admins y gestores
app.post("/api/pedidos", { config: { roles: ["admin", "gestor"] } }, async (req, reply) => {
  const result = await crearHandler.handle({ ...req.body as any, creadoPor: req.user.userId });
  if (!result.ok) return reply.code(422).send({ error: result.error.message });
  return reply.code(201).send({ id: result.value });
});

// ✅ Solo admins
app.delete("/api/pedidos/:id", { config: { roles: ["admin"] } }, async (req, reply) => {
  await eliminarHandler.handle({ id: (req.params as any).id });
  return reply.code(204).send();
});

// ✅ Ruta pública — no requiere token
app.get("/api/estado", { config: { public: true } }, async () => ({ ok: true }));
```

## Rutas de auth — las únicas públicas

```typescript
// src/adapters/http/auth.routes.ts
export async function registerAuthRoutes(app: FastifyInstance) {
  // Todas marcadas como public: true — son las ÚNICAS excepciones
  app.post("/api/auth/login",               { config: { public: true } }, loginHandler);
  app.post("/api/auth/registro",            { config: { public: true } }, registroHandler);
  app.post("/api/auth/refresh",             { config: { public: true } }, refreshHandler);
  app.post("/api/auth/recuperar-password",  { config: { public: true } }, recuperarHandler);
  app.post("/api/auth/reset-password",      { config: { public: true } }, resetHandler);
  // Nada más. El resto de /api/auth/* (p.ej. /me, /mfa) NO son públicas.
}
```

## Matriz de roles — definir antes de planificar endpoints

Antes de crear ninguna ruta, define qué puede hacer cada rol sobre cada recurso. Esto va en el ADR del proyecto.

```typescript
// src/shared/permisos.ts — fuente de verdad de permisos
export const MATRIZ_ROLES = {
  //                   admin    gestor   usuario
  pedidos: {
    crear:           ["admin", "gestor", "usuario"],  // cualquier autenticado
    listarTodos:     ["admin", "gestor"],
    listarPropios:   ["admin", "gestor", "usuario"],
    editar:          ["admin", "gestor"],
    eliminar:        ["admin"],
  },
  usuarios: {
    listar:          ["admin"],
    crear:           ["admin"],
    editarPerfil:    ["admin", "gestor", "usuario"],  // cualquier autenticado (el propio)
    eliminar:        ["admin"],
  },
  informes: {
    ver:             ["admin", "gestor"],
    exportar:        ["admin"],
  },
} as const;
```

## Autorización por propietario (el recurso es tuyo)

```typescript
// Para recursos donde el usuario solo puede acceder a los suyos:
export async function requireOwnerOrAdmin(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const recurso = await repo.findById(id);
  if (!recurso) return reply.code(404).send({ error: "No encontrado" });

  const esAdmin      = req.user.rol === "admin";
  const esPropietario = recurso.usuarioId === req.user.userId;

  if (!esAdmin && !esPropietario) {
    return reply.code(403).send({ error: "Sin permisos" });
  }
}

// Uso: se combina con el guard global (auth ya verificada)
app.get("/api/pedidos/:id", { preHandler: requireOwnerOrAdmin }, async (req) => {
  return obtenerHandler.handle({ id: (req.params as any).id });
});
```

## Checklist de seguridad antes de entregar

- [ ] `globalAuthGuard` registrado en `server.ts` como primer hook
- [ ] Todas las rutas de `/api/auth/*` tienen `config: { public: true }`
- [ ] Ninguna otra ruta tiene `config: { public: true }`
- [ ] Cada ruta tiene su rol declarado (explicit) o es `authenticated` implícito
- [ ] `MATRIZ_ROLES` definida y coherente con los `config.roles` de las rutas
- [ ] Las rutas de solo-propietario usan `requireOwnerOrAdmin`
- [ ] El audit log registra accesos denegados (403) además de los exitosos
