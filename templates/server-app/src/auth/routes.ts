import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { repos } from "../repos/index.js";
import { firmarSesion } from "./tokens.js";
import { COOKIE_SESION } from "./guard.js";
import { auditar } from "../audit.js";

/**
 * Rutas de autenticación con el SISTEMA PROPIO (email + contraseña). La sesión viaja en una cookie
 * httpOnly firmada (ver tokens.ts). El acceso a usuarios va por `repos.usuarios` (patrón repository),
 * nunca con SQL suelto. Los proveedores externos (Google, Microsoft/Entra) y el MFA se añaden encima
 * cuando el ADR lo pide (ver library/auth/login-system.md) y emiten la MISMA cookie de sesión.
 */
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 8,
};

const HASH_FALSO = "$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinv";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const Login = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post("/api/auth/login", { config: { publico: true } }, async (req, reply) => {
    const p = Login.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "datos inválidos" });
    const email = p.data.email.toLowerCase().trim();

    const u = repos.usuarios.buscarPorEmail(email);
    // Timing-safe: comparamos siempre, exista o no el usuario.
    const ok = await bcrypt.compare(p.data.password, u?.passwordHash ?? HASH_FALSO);
    if (!u || !ok || !u.activo) {
      auditar({ accion: "usuario.login", recurso: "usuario", resultado: "denegado", usuarioId: u?.id ?? null, req });
      return reply.code(401).send({ error: "Credenciales incorrectas" });
    }

    repos.usuarios.marcarAcceso(u.id, new Date().toISOString());
    const token = firmarSesion({ sub: u.id, email: u.email, rol: u.rol });
    reply.setCookie(COOKIE_SESION, token, cookieOpts);
    auditar({ accion: "usuario.login", recurso: "usuario", recursoId: u.id, resultado: "ok", usuarioId: u.id, req });
    return { usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } };
  });

  app.get("/api/auth/me", async (req) => {
    if (!req.usuario) return null;
    return repos.usuarios.buscarPorId(req.usuario.sub) ?? null;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    auditar({ accion: "usuario.logout", recurso: "usuario", resultado: "ok", usuarioId: req.usuario?.sub ?? null, req });
    reply.clearCookie(COOKIE_SESION, { path: "/" });
    return { ok: true };
  });

  // Alta de cuentas: por defecto SOLO un admin puede crear usuarios. Si el dominio necesita auto-registro
  // abierto, marca esta ruta como { publico: true } (decisión del ADR).
  const Registro = z.object({
    email: z.string().email(),
    password: z.string().min(8, "mínimo 8 caracteres"),
    nombre: z.string().min(1),
    rol: z.enum(["admin", "gestor", "usuario"]).optional(),
  });

  app.post("/api/auth/registro", { config: { roles: ["admin"] } }, async (req, reply) => {
    const p = Registro.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? "datos inválidos" });
    const email = p.data.email.toLowerCase().trim();

    if (repos.usuarios.existeEmail(email)) {
      return reply.code(409).send({ error: "Email ya registrado" });
    }
    const id = randomUUID();
    repos.usuarios.crear({
      id,
      email,
      passwordHash: await bcrypt.hash(p.data.password, 10),
      nombre: p.data.nombre,
      rol: p.data.rol ?? "usuario",
    });

    auditar({ accion: "usuario.alta", recurso: "usuario", recursoId: id, resultado: "ok", usuarioId: req.usuario?.sub ?? null, req });
    return reply.code(201).send({ id });
  });
}
