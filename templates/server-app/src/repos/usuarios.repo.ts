import { getDb } from "../db.js";

/** Persistencia de usuarios detrás de una interfaz (puerto). Login/auth/admin dependen de ESTO, no de SQLite. */
export interface Usuario { id: string; email: string; nombre: string; rol: string }
export interface UsuarioConClave extends Usuario { passwordHash: string; activo: boolean }
export interface UsuarioListado extends Usuario { activo: number; creado: string; ultimoAcceso: string | null }

export interface UsuariosRepo {
  buscarPorEmail(email: string): UsuarioConClave | undefined;
  buscarPorId(id: string): Usuario | undefined;
  existeEmail(email: string): boolean;
  existeId(id: string): boolean;
  listar(): UsuarioListado[];
  crear(u: { id: string; email: string; passwordHash: string; nombre: string; rol: string }): void;
  actualizar(id: string, cambios: { rol?: string; activo?: boolean; nombre?: string }): void;
  marcarAcceso(id: string, cuando: string): void;
  establecerClave(id: string, passwordHash: string): void;
}

interface Fila {
  id: string; email: string; nombre: string; rol: string;
  password_hash: string; activo: number; creado: string; ultimo_acceso: string | null;
}

export class UsuariosRepoSqlite implements UsuariosRepo {
  buscarPorEmail(email: string): UsuarioConClave | undefined {
    const r = getDb().prepare("SELECT * FROM usuarios WHERE email = ?").get(email) as Fila | undefined;
    if (!r) return undefined;
    return { id: r.id, email: r.email, nombre: r.nombre, rol: r.rol, passwordHash: r.password_hash, activo: !!r.activo };
  }
  buscarPorId(id: string): Usuario | undefined {
    return getDb().prepare("SELECT id, email, nombre, rol FROM usuarios WHERE id = ?").get(id) as Usuario | undefined;
  }
  existeEmail(email: string): boolean {
    return !!getDb().prepare("SELECT 1 FROM usuarios WHERE email = ?").get(email);
  }
  existeId(id: string): boolean {
    return !!getDb().prepare("SELECT 1 FROM usuarios WHERE id = ?").get(id);
  }
  listar(): UsuarioListado[] {
    return getDb()
      .prepare("SELECT id, email, nombre, rol, activo, creado, ultimo_acceso AS ultimoAcceso FROM usuarios ORDER BY creado DESC")
      .all() as UsuarioListado[];
  }
  crear(u: { id: string; email: string; passwordHash: string; nombre: string; rol: string }): void {
    getDb()
      .prepare("INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo, creado) VALUES (?, ?, ?, ?, ?, 1, ?)")
      .run(u.id, u.email, u.passwordHash, u.nombre, u.rol, new Date().toISOString());
  }
  actualizar(id: string, cambios: { rol?: string; activo?: boolean; nombre?: string }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (cambios.rol !== undefined) { sets.push("rol = ?"); vals.push(cambios.rol); }
    if (cambios.activo !== undefined) { sets.push("activo = ?"); vals.push(cambios.activo ? 1 : 0); }
    if (cambios.nombre !== undefined) { sets.push("nombre = ?"); vals.push(cambios.nombre); }
    if (!sets.length) return;
    vals.push(id);
    getDb().prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
  }
  marcarAcceso(id: string, cuando: string): void {
    getDb().prepare("UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?").run(cuando, id);
  }
  establecerClave(id: string, passwordHash: string): void {
    getDb().prepare("UPDATE usuarios SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }
}
