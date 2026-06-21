import type { FastifyInstance } from "fastify";

/**
 * Endurecimiento HTTP SIN dependencias (equivalentes ligeros a helmet y rate-limit). Suficiente para apps
 * internas/monoinstancia. Para necesidades grandes (CSP completa, store distribuido) cambia a
 * `@fastify/helmet` y `@fastify/rate-limit`. Ver library/seguridad/endurecimiento-web.md.
 */

/** Cabeceras de seguridad recomendadas (helmet-lite). */
export function registrarCabecerasSeguridad(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-DNS-Prefetch-Control", "off");
    reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    return payload;
  });
}

/**
 * Limitador de peticiones por IP (ventana fija, en memoria). Protege contra abuso y fuerza bruta de login.
 * Es POR PROCESO; si escalas a varias réplicas usa un store compartido (Redis) o `@fastify/rate-limit`.
 */
export function registrarRateLimit(
  app: FastifyInstance,
  opts: { ventanaMs?: number; max?: number; soloApi?: boolean } = {},
): void {
  const ventanaMs = opts.ventanaMs ?? 60_000;
  const max = opts.max ?? 300;
  const soloApi = opts.soloApi ?? true;
  const hits = new Map<string, { n: number; reset: number }>();

  app.addHook("onRequest", async (req, reply) => {
    if (soloApi && !req.url.startsWith("/api")) return;
    const ahora = Date.now();
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "?";
    const e = hits.get(ip);
    if (!e || e.reset < ahora) {
      hits.set(ip, { n: 1, reset: ahora + ventanaMs });
      return;
    }
    e.n++;
    if (e.n > max) {
      reply.header("Retry-After", String(Math.ceil((e.reset - ahora) / 1000)));
      return reply.code(429).send({ error: "Demasiadas peticiones, inténtalo en un momento." });
    }
  });

  // Limpieza periódica de IPs caducadas (no impide cerrar el proceso).
  const t = setInterval(() => {
    const ahora = Date.now();
    for (const [ip, e] of hits) if (e.reset < ahora) hits.delete(ip);
  }, ventanaMs);
  if (typeof t.unref === "function") t.unref();
}
