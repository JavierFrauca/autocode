import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

/** Registro de accesos / auditoría detrás de una interfaz. `audit.ts` la usa. El actor es la API key. */
export interface EventoAcceso {
  actorId?: string | null;
  accion: string;
  recurso: string;
  recursoId?: string | null;
  resultado: "ok" | "error" | "denegado";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AccesosRepo {
  registrar(e: EventoAcceso): void;
}

export class AccesosRepoSqlite implements AccesosRepo {
  registrar(e: EventoAcceso): void {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, actor_id, accion, recurso, recurso_id, resultado, ip, user_agent, metadata, creado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), e.actorId ?? null, e.accion, e.recurso, e.recursoId ?? null, e.resultado,
        e.ip ?? null, e.userAgent ?? null, e.metadata ? JSON.stringify(e.metadata) : null, new Date().toISOString(),
      );
  }
}
