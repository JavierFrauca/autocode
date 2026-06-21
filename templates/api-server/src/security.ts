import type { FastifyInstance } from "fastify";

/**
 * Endurecimiento HTTP SIN dependencias (helmet-lite + rate-limit-lite + CORS-lite). Para necesidades
 * grandes cambia a `@fastify/helmet`/`@fastify/rate-limit`/`@fastify/cors`. Ver
 * library/seguridad/endurecimiento-web.md.
 */

/** Cabeceras de seguridad recomendadas (helmet-lite). */
export function registrarCabecerasSeguridad(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-DNS-Prefetch-Control", "off");
    return payload;
  });
}

/** Limitador de peticiones por IP (ventana fija, en memoria). Protege un servicio expuesto del abuso. */
export function registrarRateLimit(
  app: FastifyInstance,
  opts: { ventanaMs?: number; max?: number } = {},
): void {
  const ventanaMs = opts.ventanaMs ?? 60_000;
  const max = opts.max ?? 300;
  const hits = new Map<string, { n: number; reset: number }>();

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api")) return;
    const ahora = Date.now();
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "?";
    const e = hits.get(ip);
    if (!e || e.reset < ahora) { hits.set(ip, { n: 1, reset: ahora + ventanaMs }); return; }
    e.n++;
    if (e.n > max) {
      reply.header("Retry-After", String(Math.ceil((e.reset - ahora) / 1000)));
      return reply.code(429).send({ error: "Demasiadas peticiones, inténtalo en un momento." });
    }
  });

  const t = setInterval(() => {
    const ahora = Date.now();
    for (const [ip, e] of hits) if (e.reset < ahora) hits.delete(ip);
  }, ventanaMs);
  if (typeof t.unref === "function") t.unref();
}

/**
 * CORS (lista blanca de orígenes). Un servicio API suele consumirse desde otros sistemas; si lo llama un
 * NAVEGADOR de otro origen, declara los orígenes en ALLOWED_ORIGINS (coma-separados). Sin esa variable no
 * se emiten cabeceras CORS (consumo servidor-a-servidor no las necesita). Maneja el preflight OPTIONS.
 */
export function registrarCors(app: FastifyInstance, origenes: string[]): void {
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    const permitido = origin && (origenes.includes("*") || origenes.includes(origin));
    if (permitido) {
      reply.header("Access-Control-Allow-Origin", origenes.includes("*") ? "*" : origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "content-type,authorization,x-api-key");
    }
    if (req.method === "OPTIONS") return reply.code(204).send(); // preflight: no exige API key
  });
}
