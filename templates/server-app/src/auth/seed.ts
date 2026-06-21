import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { repos } from "../repos/index.js";

/**
 * Siembra el primer administrador (bootstrap). Sin esto, una app con login obligatorio no tendría por
 * dónde entrar la primera vez. Va por el repositorio (`repos.usuarios`), no con SQL suelto. Idempotente:
 *  - Si SEED_ADMIN_PASSWORD está definida (la fija AutoCode al "Probar"), crea/actualiza admin@example.com
 *    con esa clave → las credenciales que muestra "Probar" siempre funcionan.
 *  - Si no, en DESARROLLO usa una clave por defecto; en PRODUCCIÓN no crea nada inseguro.
 * Devuelve el email sembrado (para mostrarlo) o null si no sembró.
 */
export async function seedAdmin(): Promise<{ email: string } | null> {
  // El email debe ser VÁLIDO (la ruta de login valida formato con Zod): admin@example.com (placeholder válido).
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const esProd = process.env.NODE_ENV === "production";
  const pass = process.env.SEED_ADMIN_PASSWORD ?? (esProd ? null : "cambia-esto-1234");
  if (!pass) return null;

  const existente = repos.usuarios.buscarPorEmail(email);
  const hash = await bcrypt.hash(pass, 10);

  if (existente) {
    // En dev (o si se pasa la clave a propósito) reseteamos la clave del admin para no quedar fuera.
    if (process.env.SEED_ADMIN_PASSWORD || !esProd) {
      repos.usuarios.establecerClave(existente.id, hash);
      repos.usuarios.actualizar(existente.id, { activo: true, rol: "admin" });
    }
  } else {
    repos.usuarios.crear({ id: randomUUID(), email, passwordHash: hash, nombre: "Administrador", rol: "admin" });
  }
  return { email };
}
