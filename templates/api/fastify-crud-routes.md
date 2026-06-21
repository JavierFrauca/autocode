# Template: Rutas CRUD Fastify

**tags:** fastify, crud, routes, typescript
**transversal:** true

```typescript
// src/routes/entidades.ts — reemplaza "entidad" por tu nombre
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EntidadRepository } from "../repositories/EntidadRepository.js";

const repo = new EntidadRepository();

const CreateSchema = z.object({
  nombre: z.string().min(1),
  // ... campos según modelo
});

export async function registerEntidadRoutes(app: FastifyInstance): Promise<void> {
  // Listar
  app.get("/api/entidades", async () => {
    return repo.findAll();
  });

  // Obtener por ID
  app.get("/api/entidades/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await repo.findById(id);
    if (!item) return reply.code(404).send({ error: "No encontrado" });
    return item;
  });

  // Crear
  app.post("/api/entidades", async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return repo.create(parsed.data);
  });

  // Actualizar
  app.put("/api/entidades/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await repo.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "No encontrado" });
    return updated;
  });

  // Borrar
  app.delete("/api/entidades/:id", async (req) => {
    const { id } = req.params as { id: string };
    await repo.delete(id);
    return { ok: true };
  });
}
```
