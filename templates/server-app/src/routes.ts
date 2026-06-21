import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repos } from "./repos/index.js";

/**
 * Rutas de la API (capa adaptador). Solo traducen HTTP ↔ dominio y validan con Zod; el acceso a datos va
 * por el REPOSITORIO (`repos.items`), nunca con SQL suelto. CRUD mínimo de ejemplo ("items") para que la
 * app arranque y se pueda probar; el agente lo reemplaza por las entidades reales (cada una con su repo).
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/items", async () => {
    return repos.items.listar();
  });

  const NuevoItem = z.object({ nombre: z.string().min(1, "el nombre es obligatorio") });
  app.post("/api/items", async (req, reply) => {
    const parsed = NuevoItem.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "datos inválidos" });
    }
    const item = repos.items.crear(parsed.data.nombre);
    return reply.code(201).send(item);
  });

  app.delete("/api/items/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "id inválido" });
    repos.items.borrar(id);
    return reply.code(204).send();
  });
}
