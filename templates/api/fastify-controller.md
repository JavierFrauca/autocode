# Template: Controlador Fastify completo

**tags:** fastify, controller, crud, typescript, zod
**transversal:** true

Reemplaza `Entidad` / `entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/routes/entidades.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { CrearEntidadHandler }      from "../commands/CrearEntidadCommand.js";
import { ActualizarEntidadHandler } from "../commands/ActualizarEntidadCommand.js";
import { EliminarEntidadHandler }   from "../commands/EliminarEntidadCommand.js";
import { ListarEntidadesHandler }   from "../queries/ListarEntidadesQuery.js";
import { ObtenerEntidadHandler }    from "../queries/ObtenerEntidadQuery.js";
import { EntidadRepository }        from "../repositories/EntidadRepository.js";
import { db }                       from "../db/client.js";

// ── Schemas de validación ────────────────────────────────────────────────────
const CrearSchema = z.object({
  nombre:      z.string().min(1).max(200),
  descripcion: z.string().max(1000).optional(),
  // añadir campos según modelo
});

const ActualizarSchema = CrearSchema.partial();

const FiltrosSchema = z.object({
  busqueda:  z.string().optional(),
  pagina:    z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Registro de rutas ────────────────────────────────────────────────────────
export async function registerEntidadRoutes(app: FastifyInstance): Promise<void> {
  const repo = new EntidadRepository(db());

  // GET /api/entidades — listar con filtros y paginación
  app.get("/api/entidades", { preHandler: requireAuth }, async (req, reply) => {
    const filtros = FiltrosSchema.parse(req.query);
    const handler = new ListarEntidadesHandler(db());
    return handler.handle(filtros);
  });

  // GET /api/entidades/:id — obtener una
  app.get("/api/entidades/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const handler = new ObtenerEntidadHandler(repo);
    const item = await handler.handle(id);
    if (!item) return reply.code(404).send({ error: "No encontrado" });
    return item;
  });

  // POST /api/entidades — crear
  app.post("/api/entidades", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = CrearSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const handler = new CrearEntidadHandler(repo);
    const id = await handler.handle({ ...parsed.data, usuarioId: req.user.userId });
    return reply.code(201).send({ id });
  });

  // PUT /api/entidades/:id — actualizar
  app.put("/api/entidades/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ActualizarSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const handler = new ActualizarEntidadHandler(repo);
    const result = await handler.handle({ id, ...parsed.data, usuarioId: req.user.userId });
    if (!result) return reply.code(404).send({ error: "No encontrado" });
    return result;
  });

  // DELETE /api/entidades/:id — eliminar (solo admin)
  app.delete("/api/entidades/:id", {
    preHandler: [requireAuth, requireRole("admin")],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const handler = new EliminarEntidadHandler(repo);
    await handler.handle(id);
    return reply.code(204).send();
  });
}
```

```typescript
// src/server.ts — registrar las rutas
import { registerEntidadRoutes } from "./routes/entidades.js";
await registerEntidadRoutes(app);
```
