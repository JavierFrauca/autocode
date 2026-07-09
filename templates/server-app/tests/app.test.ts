import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PUBLIC = join(__dirname, "fixtures", "public");

/**
 * Test de RUTA (integración) vía `app.inject()` — sin abrir puerto real. Cubre el guard de sesión
 * (lo más importante de este andamiaje: sin login nadie entra a /api/*) y el flujo de login con el
 * admin sembrado.
 */
describe("server-app", () => {
  let app: FastifyInstance;
  const PASSWORD = "clave-de-test-1234";

  beforeAll(async () => {
    process.env.SEED_ADMIN_PASSWORD = PASSWORD;
    app = await buildApp(":memory:", FIXTURE_PUBLIC);
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health es público, no requiere sesión", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("GET /api/items sin sesión => 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.statusCode).toBe(401);
  });

  it("login con credenciales incorrectas => 401, sin cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "no-es-esta" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toHaveLength(0);
  });

  it("login con el admin sembrado => 200, cookie de sesión, y ya se puede listar", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().usuario.email).toBe("admin@example.com");
    const cookie = login.cookies.find((c) => c.name === "sesion");
    expect(cookie).toBeTruthy();

    const items = await app.inject({
      method: "GET",
      url: "/api/items",
      cookies: { sesion: cookie!.value },
    });
    expect(items.statusCode).toBe(200);
    expect(items.json()).toEqual([]);
  });

  it("una ruta que no es /api ni un estático conocido cae al SPA fallback (index.html)", async () => {
    const res = await app.inject({ method: "GET", url: "/cualquier-ruta-del-front" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<html");
  });
});
