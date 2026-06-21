import type { FastifyRequest } from "fastify";
import { repos } from "./repos/index.js";

/**
 * Registro de accesos / auditoría — quién hizo qué y cuándo. OBLIGATORIO en apps web. Persiste a través
 * del repositorio (`repos.accesos`), nunca con SQL suelto. NUNCA debe tumbar la petición: si falla al
 * registrar, se traga el error. Convención de acción: "recurso.verbo" (p.ej. "usuario.login").
 */
export interface EventoAuditoria {
  accion: string;
  recurso: string;
  recursoId?: string | null;
  resultado: "ok" | "error" | "denegado";
  usuarioId?: string | null;
  req?: FastifyRequest;
  metadata?: Record<string, unknown>;
}

export function auditar(e: EventoAuditoria): void {
  try {
    repos.accesos.registrar({
      usuarioId: e.usuarioId ?? null,
      accion: e.accion,
      recurso: e.recurso,
      recursoId: e.recursoId ?? null,
      resultado: e.resultado,
      ip: ipDe(e.req),
      userAgent: e.req?.headers["user-agent"]?.slice(0, 200) ?? null,
      metadata: e.metadata ?? null,
    });
  } catch {
    /* la auditoría nunca debe romper la petición */
  }
}

function ipDe(req?: FastifyRequest): string | null {
  if (!req) return null;
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd ?? req.ip ?? null;
}
