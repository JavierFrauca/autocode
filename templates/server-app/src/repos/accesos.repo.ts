import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

/** Persistencia del registro de accesos / auditoría detrás de una interfaz. `audit.ts` la usa. */
export interface EventoAcceso {
  usuarioId?: string | null;
  accion: string;
  recurso: string;
  recursoId?: string | null;
  resultado: "ok" | "error" | "denegado";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface AccesoListado {
  id: string; usuarioId: string | null; accion: string; recurso: string;
  recursoId: string | null; resultado: string; ip: string | null; creado: string;
}
export interface FiltroAccesos { accion?: string; resultado?: string; desde?: string; hasta?: string }

export interface AccesosRepo {
  registrar(e: EventoAcceso): void;
  contar(f: FiltroAccesos): number;
  listar(f: FiltroAccesos, limite: number, offset: number): AccesoListado[];
}

export class AccesosRepoSqlite implements AccesosRepo {
  registrar(e: EventoAcceso): void {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, usuario_id, accion, recurso, recurso_id, resultado, ip, user_agent, metadata, creado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), e.usuarioId ?? null, e.accion, e.recurso, e.recursoId ?? null, e.resultado,
        e.ip ?? null, e.userAgent ?? null, e.metadata ? JSON.stringify(e.metadata) : null, new Date().toISOString(),
      );
  }
  private where(f: FiltroAccesos): { sql: string; vals: unknown[] } {
    const cond: string[] = [];
    const vals: unknown[] = [];
    if (f.accion) { cond.push("accion LIKE ?"); vals.push(`%${f.accion}%`); }
    if (f.resultado) { cond.push("resultado = ?"); vals.push(f.resultado); }
    if (f.desde) { cond.push("creado >= ?"); vals.push(f.desde); }
    if (f.hasta) { cond.push("creado <= ?"); vals.push(f.hasta); }
    return { sql: cond.length ? `WHERE ${cond.join(" AND ")}` : "", vals };
  }
  contar(f: FiltroAccesos): number {
    const { sql, vals } = this.where(f);
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM audit_log ${sql}`).get(...(vals as never[])) as { n: number }).n;
  }
  listar(f: FiltroAccesos, limite: number, offset: number): AccesoListado[] {
    const { sql, vals } = this.where(f);
    return getDb()
      .prepare(
        `SELECT id, usuario_id AS usuarioId, accion, recurso, recurso_id AS recursoId, resultado, ip, creado
         FROM audit_log ${sql} ORDER BY creado DESC LIMIT ? OFFSET ?`,
      )
      .all(...(vals as never[]), limite, offset) as AccesoListado[];
  }
}
