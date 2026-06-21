import type { FastifyRequest } from "fastify";
import { repos } from "./repos/index.js";

/**
 * Registro de accesos / auditoría — quién (qué API key) hizo qué y cuándo. Persiste a través de
 * `repos.accesos`, nunca con SQL suelto. NUNCA debe tumbar la petición. Acción: "recurso.verbo".
 */
export interface EventoAuditoria {
  accion: string;
  recurso: string;
  recursoId?: string | null;
  resultado: "ok" | "error" | "denegado";
  actorId?: string | null; // id de la API key que actuó
  req?: FastifyRequest;
  metadata?: Record<string, unknown>;
}

export function auditar(e: EventoAuditoria): void {
  try {
    repos.accesos.registrar({
      actorId: e.actorId ?? e.req?.apiKeyId ?? null,
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
