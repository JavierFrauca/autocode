import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verificarSesion, type Sesion } from "./tokens.js";

/**
 * Seguridad GLOBAL, secure-by-default (opt-out, no opt-in). Un único hook protege TODAS las rutas:
 *  - Los recursos del front (la SPA + sus estáticos: GET fuera de /api) son públicos — si no, el
 *    navegador no podría ni cargar la pantalla de login.
 *  - Todo /api/* exige sesión, SALVO las rutas marcadas con `config: { publico: true }` (login, health).
 *  - `config: { roles: [...] }` restringe por rol.
 * La frontera de seguridad real es esta, en el servidor; el guard del router del front es solo UX.
 *
 * ROLES: "admin"/"gestor"/"usuario" son un PUNTO DE PARTIDA de ejemplo, no una lista cerrada. Cuando el
 * dominio tenga roles propios (p.ej. "contable", "almacenero", "comercial"), sustituye el array `ROLES`
 * por los roles reales — es el ÚNICO sitio que hace falta tocar: `Rol` y las comprobaciones de este
 * fichero se derivan de él, y `admin-routes.ts` importa el mismo array para su validación Zod, así los
 * roles nunca quedan desincronizados entre el guard y la gestión de usuarios. Mantén siempre "admin"
 * como super-rol con acceso total.
 */
export const ROLES = ["admin", "gestor", "usuario"] as const;
export type Rol = (typeof ROLES)[number];
export const COOKIE_SESION = "sesion";

declare module "fastify" {
  interface FastifyRequest {
    usuario?: Sesion;
  }
  interface FastifyContextConfig {
    publico?: true;
    roles?: Rol[];
  }
}

export function registrarGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions.config?.publico) return;
    // Recursos del front (SPA + estáticos): GET fuera de /api → públicos (la seguridad está en /api).
    if (req.method === "GET" && !req.url.startsWith("/api")) return;

    const sesion = verificarSesion(req.cookies?.[COOKIE_SESION]);
    if (!sesion) return reply.code(401).send({ error: "No autenticado" });
    req.usuario = sesion;

    const roles = req.routeOptions.config?.roles;
    if (roles?.length && !roles.includes(sesion.rol as Rol)) {
      return reply.code(403).send({ error: "Sin permisos suficientes" });
    }
  });
}
