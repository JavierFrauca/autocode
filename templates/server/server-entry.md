# Template: entrada del servidor (src/server.ts + adapters/http/index.ts)

**tags:** server, fastify, server.ts, registerRoutes, di, health
**transversal:** true
**Cuándo usar:** la entrada del backend. Arranca Fastify, registra CORS y las rutas, y escucha. Aquí se ensambla la inyección de dependencias (repos → handlers → rutas).

`src/server.ts`:
```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./adapters/http/index.js";

const app = Fastify({ logger: process.env.NODE_ENV !== "production" });

await app.register(cors, { origin: process.env.CORS_ORIGIN ?? true });

// Health check
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// Rutas de negocio (con su inyección de dependencias dentro)
await registerRoutes(app);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Servidor en puerto ${port}`);
```

`src/adapters/http/index.ts` (registra TODAS las rutas; aquí se ensambla la DI):
```typescript
import type { FastifyInstance } from "fastify";
// import { DrizzlePedidoRepository } from "../../infrastructure/db/DrizzlePedidoRepository.js";
// import { CrearPedidoHandler } from "../../application/commands/CrearPedido.handler.js";
// import { registerPedidoRoutes } from "./pedidos.routes.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Construir el grafo de dependencias UNA vez y pasar los handlers a las rutas:
  // const pedidoRepo = new DrizzlePedidoRepository();
  // const crearHandler = new CrearPedidoHandler(pedidoRepo);
  // await registerPedidoRoutes(app, crearHandler);

  // (vacío hasta que añadas casos de uso)
  void app;
}
```

## Notas
- `await` a nivel superior funciona porque el package.json es `"type": "module"` + tsconfig NodeNext.
- Los imports relativos llevan **`.js`** (`./adapters/http/index.js`) por NodeNext — aunque el fichero sea `.ts`.
- `registerRoutes` es el ÚNICO sitio donde se hace `new XxxRepository()` / `new XxxHandler()` — el resto del código recibe los puertos inyectados, nunca instancia implementaciones.
- Variables por `process.env` (PORT, CORS_ORIGIN, DATABASE_URL…). Para `.env` añade `dotenv` e `import "dotenv/config"` al principio.
