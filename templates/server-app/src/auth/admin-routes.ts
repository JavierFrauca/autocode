import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repos } from "../repos/index.js";
import { auditar } from "../audit.js";

/**
 * Área de ADMINISTRACIÓN (solo rol "admin"): gestión de usuarios y visor del registro de accesos. Todo el
 * acceso a datos va por los repositorios (`repos.usuarios`, `repos.accesos`), nunca con SQL suelto. El alta
 * de usuarios está en routes.ts (`/api/auth/registro`, admin).
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Usuarios ─────────────────────────────────────────────────────────────────────────────────
  app.get("/api/auth/usuarios", { config: { roles: ["admin"] } }, async () => {
    return repos.usuarios.listar();
  });

  const Patch = z.object({
    rol: z.enum(["admin", "gestor", "usuario"]).optional(),
    activo: z.boolean().optional(),
    nombre: z.string().min(1).optional(),
  });

  app.patch("/api/auth/usuarios/:id", { config: { roles: ["admin"] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = Patch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "datos inválidos" });

    // No puedes desactivarte ni quitarte el rol admin a ti mismo (te quedarías fuera).
    const soyYo = id === req.usuario?.sub;
    if (soyYo && (p.data.activo === false || (p.data.rol && p.data.rol !== "admin"))) {
      return reply.code(400).send({ error: "No puedes desactivarte ni quitarte el rol admin a ti mismo." });
    }
    if (!repos.usuarios.existeId(id)) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }

    repos.usuarios.actualizar(id, p.data);
    auditar({ accion: "usuario.editar", recurso: "usuario", recursoId: id, resultado: "ok", usuarioId: req.usuario?.sub ?? null, req, metadata: p.data });
    return { ok: true };
  });

  // ── Registro de accesos / auditoría (con filtros + paginación) ─────────────────────────────────
  app.get("/api/auth/accesos", { config: { roles: ["admin"] } }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const lim = Math.min(200, Math.max(1, Number(q.limite ?? 100)));
    const pag = Math.max(1, Number(q.pagina ?? 1));
    const filtro = { accion: q.accion, resultado: q.resultado, desde: q.desde, hasta: q.hasta };

    const total = repos.accesos.contar(filtro);
    const items = repos.accesos.listar(filtro, lim, (pag - 1) * lim);
    return { total, pagina: pag, limite: lim, items };
  });
}
