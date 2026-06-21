# Arquitectura hexagonal — estructura de carpetas y puertos

**Categoría:** arquitectura | **Cuándo usar:** Siempre. Es la estructura obligatoria del stack. No es opcional ni se negocia con el usuario.

## Por qué es importante con usuarios que cambian de opinión

Cada cambio de requisito toca una capa concreta. Si las capas están mezcladas, un cambio en la UI rompe la lógica de negocio, y un cambio en la BD rompe las rutas. Con hexagonal, los cambios quedan contenidos:

- El usuario cambia una validación → solo toca `domain/`
- El usuario cambia de SQLite a PostgreSQL → solo toca `infrastructure/`
- El usuario añade una ruta nueva → solo toca `adapters/`
- El usuario cambia la pantalla → solo toca `ui/`

## Estructura de carpetas obligatoria

```
src/
├── domain/                     ← El núcleo. Sin imports de frameworks.
│   ├── entities/
│   │   └── Pedido.ts           ← Entidad con invariantes de negocio
│   ├── ports/
│   │   ├── PedidoRepository.ts ← Interface (puerto de salida)
│   │   └── EmailPort.ts        ← Interface (puerto de salida)
│   └── errors/
│       └── DomainError.ts
│
├── application/                ← Casos de uso. Orquesta dominio + puertos.
│   ├── commands/
│   │   ├── CrearPedido.command.ts
│   │   └── CrearPedido.handler.ts
│   └── queries/
│       ├── ListarPedidos.query.ts
│       └── ListarPedidos.handler.ts
│
├── infrastructure/             ← Implementaciones concretas de los puertos.
│   ├── db/
│   │   ├── schema.ts           ← Drizzle schema
│   │   └── DrizzlePedidoRepository.ts  ← Implementa PedidoRepository
│   └── email/
│       └── NodemailerEmailAdapter.ts   ← Implementa EmailPort
│
├── adapters/                   ← Entrada al sistema. Solo traducen.
│   └── http/
│       └── pedidos.routes.ts   ← Fastify routes → Commands/Queries
│
└── shared/
    ├── Result.ts               ← Ok<T> / Err<E>
    └── ulid.ts
```

## Las cuatro capas — qué puede importar de qué

```
UI (Vue)  →  adapters/  →  application/  →  domain/
                              ↓
                        infrastructure/
```

| Capa | Puede importar | NO puede importar |
|---|---|---|
| `domain/` | Nada externo. Solo tipos de TypeScript | Fastify, Drizzle, Node, nada |
| `application/` | `domain/` | Fastify, Drizzle, implementaciones concretas |
| `infrastructure/` | `domain/` (las interfaces), Drizzle, Node | `application/`, `adapters/` |
| `adapters/` | `application/` (handlers), Zod para validar HTTP | `domain/` directamente, `infrastructure/` directamente |

## Puerto — definición (en domain/)

```typescript
// src/domain/ports/PedidoRepository.ts
export interface PedidoRepository {
  findById(id: string):                       Promise<Pedido | null>;
  findAll(filtros: FiltrosPedido):            Promise<{ items: Pedido[]; total: number }>;
  save(pedido: Pedido):                       Promise<void>;
  delete(id: string):                         Promise<void>;
}
```

## Adaptador — implementación (en infrastructure/)

```typescript
// src/infrastructure/db/DrizzlePedidoRepository.ts
import type { PedidoRepository } from "../../domain/ports/PedidoRepository.js";

export class DrizzlePedidoRepository implements PedidoRepository {
  async findById(id: string): Promise<Pedido | null> {
    const rows = await db().select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    return rows[0] ? toDomain(rows[0]) : null;
  }
  // ... resto de métodos
}
```

## Command + Handler (en application/)

```typescript
// src/application/commands/CrearPedido.command.ts
export interface CrearPedidoCommand {
  clienteId: string;
  lineas:    { productoId: string; cantidad: number }[];
}

// src/application/commands/CrearPedido.handler.ts
export class CrearPedidoHandler {
  constructor(
    private pedidos:   PedidoRepository,   // ← puerto, no implementación
    private productos: ProductoRepository,
    private emails:    EmailPort,
  ) {}

  async handle(cmd: CrearPedidoCommand): Promise<Result<string, DomainError>> {
    // Validación de negocio aquí, no en la ruta
    for (const linea of cmd.lineas) {
      const prod = await this.productos.findById(linea.productoId);
      if (!prod) return Err(new DomainError(`Producto ${linea.productoId} no existe`));
      if (prod.stock < linea.cantidad) return Err(new DomainError("Sin stock suficiente"));
    }
    const id = ulid().toLowerCase();
    await this.pedidos.save(new Pedido({ id, ...cmd }));
    await this.emails.enviarConfirmacion(cmd.clienteId, id);  // ← puerto, no Nodemailer directo
    return Ok(id);
  }
}
```

## Adaptador HTTP — ruta Fastify (en adapters/)

```typescript
// src/adapters/http/pedidos.routes.ts
import { z } from "zod";
import { CrearPedidoHandler } from "../../application/commands/CrearPedido.handler.js";

const CrearPedidoSchema = z.object({
  clienteId: z.string(),
  lineas:    z.array(z.object({ productoId: z.string(), cantidad: z.number().int().positive() })),
});

export async function registerPedidoRoutes(
  app: FastifyInstance,
  handler: CrearPedidoHandler,  // ← inyectado desde server.ts
) {
  app.post("/api/pedidos", { preHandler: requireAuth }, async (req, reply) => {
    // La ruta SOLO valida HTTP y traduce. Nada más.
    const parsed = CrearPedidoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const result = await handler.handle(parsed.data);

    if (!result.ok) return reply.code(422).send({ error: result.error.message });
    return reply.code(201).send({ id: result.value });
  });
}
```

## Inyección de dependencias en server.ts

```typescript
// src/server.ts — donde se ensambla todo
import { DrizzlePedidoRepository }   from "./infrastructure/db/DrizzlePedidoRepository.js";
import { DrizzleProductoRepository } from "./infrastructure/db/DrizzleProductoRepository.js";
import { NodemailerEmailAdapter }     from "./infrastructure/email/NodemailerEmailAdapter.js";
import { CrearPedidoHandler }         from "./application/commands/CrearPedido.handler.js";
import { registerPedidoRoutes }       from "./adapters/http/pedidos.routes.js";

// Construir el grafo de dependencias
const pedidoRepo   = new DrizzlePedidoRepository();
const productoRepo = new DrizzleProductoRepository();
const emailAdapter = new NodemailerEmailAdapter();
const crearHandler = new CrearPedidoHandler(pedidoRepo, productoRepo, emailAdapter);

// Registrar rutas pasando los handlers ya construidos
await registerPedidoRoutes(app, crearHandler);
```

## Regla de oro para cambios de requisito

Antes de tocar código, identifica la capa afectada:

| El usuario pide... | Capa afectada | Tocar |
|---|---|---|
| Cambiar una validación | Domain | Solo `domain/entities/` o el handler |
| Añadir un campo a una entidad | Domain + Infra | Entidad + schema Drizzle + migración |
| Cambiar cómo se guarda algo | Infrastructure | Solo `DrizzleXxxRepository` |
| Añadir un endpoint nuevo | Adapter + Application | Nueva ruta + nuevo Command o Query |
| Cambiar la respuesta HTTP | Adapter | Solo la ruta |
| Añadir un proveedor de email | Infrastructure | Nuevo adaptador que implementa `EmailPort` |

Si el cambio toca más de dos capas a la vez, es señal de que hay lógica en el lugar equivocado.
