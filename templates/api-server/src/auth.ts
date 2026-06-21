import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { repos } from "./repos/index.js";

/**
 * Autenticación del servicio por **API KEY** (no login de usuario). Secure-by-default: un hook global
 * protege TODO `/api/*` salvo lo marcado `publico`. La clave viaja en `Authorization: Bearer <clave>` o
 * `X-API-Key`. En la BD se guarda solo el HASH (vía `repos.apiKeys`), nunca la clave en claro.
 */
export const HASH = (k: string): string => createHash("sha256").update(k).digest("hex");

declare module "fastify" {
  interface FastifyRequest {
    apiKeyId?: string;
  }
  interface FastifyContextConfig {
    publico?: true;
  }
}

export function registrarGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions.config?.publico) return;
    if (!req.url.startsWith("/api")) return; // la página de estado y demás no-API no exigen clave

    const auth = req.headers.authorization;
    const key = auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-api-key"] as string | undefined);
    if (!key) {
      return reply.code(401).send({ error: "Falta la API key (Authorization: Bearer <clave> o X-API-Key)" });
    }
    const fila = repos.apiKeys.buscarPorHash(HASH(key));
    if (!fila || !fila.activo) return reply.code(401).send({ error: "API key inválida o revocada" });

    req.apiKeyId = fila.id;
    repos.apiKeys.marcarUso(fila.id, new Date().toISOString());
  });
}

/**
 * Siembra una API key inicial (bootstrap), vía `repos.apiKeys`. Idempotente:
 *  - Si API_KEY está definida (la fija AutoCode al "Probar"), crea/actualiza la clave 'clave-inicial'.
 *  - Si no, en DESARROLLO usa una clave por defecto; en PRODUCCIÓN no crea nada inseguro.
 */
export async function seedApiKey(): Promise<{ nombre: string } | null> {
  const provided = process.env.API_KEY;
  const esProd = process.env.NODE_ENV === "production";
  const clave = provided ?? (esProd ? null : "clave-de-desarrollo-cambiar");
  if (!clave) return null;

  const nombre = "clave-inicial";
  const hash = HASH(clave);
  const existente = repos.apiKeys.buscarPorNombre(nombre);
  if (existente) {
    if (provided || !esProd) repos.apiKeys.establecerHash(existente.id, hash);
  } else {
    repos.apiKeys.crear({ id: randomUUID(), nombre, keyHash: hash });
  }
  return { nombre };
}
