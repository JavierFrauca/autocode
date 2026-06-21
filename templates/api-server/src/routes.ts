import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repos } from "./repos/index.js";
import { auditar } from "./audit.js";

/**
 * Endpoints de la API (capa adaptador). Validan con Zod y delegan la persistencia en el REPOSITORIO
 * (`repos.items`), nunca con SQL suelto. Todo va protegido por API key (guard global). CRUD de ejemplo
 * ('items') + receptor de WEBHOOK; el agente lo reemplaza por el dominio real (cada entidad con su repo).
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
    auditar({ accion: "item.crear", recurso: "item", recursoId: String(item.id), resultado: "ok", req });
    return reply.code(201).send(item);
  });

  // ── Receptor de WEBHOOK de ejemplo (integración entrante) ───────────────────────────────────────
  app.post("/api/webhooks/ejemplo", async (req, reply) => {
    auditar({ accion: "webhook.recibir", recurso: "webhook", resultado: "ok", req, metadata: { tipo: "ejemplo" } });
    return reply.code(200).send({ recibido: true });
  });
}
