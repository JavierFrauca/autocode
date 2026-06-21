# Template: Test de integración de una ruta Fastify

**tags:** test, vitest, fastify, integration, inject
**transversal:** true

Ejercita la ruta REAL con `app.inject` (no abre puerto de red, no necesita BD si inyectas un handler de prueba).

```typescript
// tests/pedidos.routes.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPedidoRoutes } from "../src/adapters/http/pedidos.routes.js";
import { CrearPedidoHandler } from "../src/application/commands/CrearPedido.handler.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  // Handler con repos en memoria: NO se toca la BD real en los tests.
  const handler = new CrearPedidoHandler(
    { save: async () => {}, findById: async () => null } as any,
    { findById: async () => ({ id: "p1", stock: 9 }) } as any,
    { enviarConfirmacion: async () => {} } as any,
  );
  await registerPedidoRoutes(app, handler);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/pedidos", () => {
  it("devuelve 400 si el cuerpo es inválido", async () => {
    const res = await app.inject({ method: "POST", url: "/api/pedidos", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("crea un pedido y devuelve 201 con el id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pedidos",
      payload: { clienteId: "c1", lineas: [{ productoId: "p1", cantidad: 1 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty("id");
  });
});
```

Notas:
- `app.inject` es la forma canónica de Fastify para tests: no hay puertos ni esperas de red, es rápido y determinista.
- El adaptador HTTP solo traduce: el test comprueba **códigos de estado** y forma de la respuesta, no la lógica de negocio (esa se prueba en `templates/api/test-handler`).
