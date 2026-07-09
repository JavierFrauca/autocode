import type { FastifyInstance } from "fastify";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

/**
 * Test de RUTA (integración) vía `app.inject()` — sin abrir puerto real. Cubre el guard de API key
 * (lo más importante de este andamiaje: sin clave nadie entra) y el CRUD de ejemplo.
 */
describe("api-server", () => {
  let app: FastifyInstance;
  const API_KEY = "clave-de-test";

  beforeAll(async () => {
    process.env.API_KEY = API_KEY;
    app = await buildApp(":memory:");
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health es público, no requiere clave", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("GET /api/items sin clave => 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/items con clave inválida => 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items", headers: { authorization: "Bearer no-es-esta" } });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/items con clave válida => 200 y lista vacía", async () => {
    const res = await app.inject({ method: "GET", url: "/api/items", headers: { authorization: `Bearer ${API_KEY}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST /api/items crea y luego aparece en el listado", async () => {
    const crear = await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { nombre: "primero" },
    });
    expect(crear.statusCode).toBe(201);
    expect(crear.json().nombre).toBe("primero");

    const listar = await app.inject({ method: "GET", url: "/api/items", headers: { authorization: `Bearer ${API_KEY}` } });
    expect(listar.json()).toHaveLength(1);
  });

  it("POST /api/items sin nombre => 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
