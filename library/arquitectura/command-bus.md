# Command Bus — enrutador central de commands y queries

**Categoría:** arquitectura | **Cuándo usar:** Cuando hay muchos handlers y se quiere despachar desde cualquier parte sin importar el handler concreto.

## Concepto
El Bus actúa como intermediario: recibe un Command/Query, encuentra el Handler registrado y lo ejecuta. Permite añadir middlewares transversales (logging, transacciones, autorización) sin tocar los handlers.

## Implementación simple

```typescript
// bus/CommandBus.ts
type Handler<C, R> = { handle(cmd: C): Promise<R> };

export class CommandBus {
  private handlers = new Map<string, Handler<any, any>>();

  register<C, R>(commandName: string, handler: Handler<C, R>): void {
    this.handlers.set(commandName, handler);
  }

  async dispatch<R>(commandName: string, command: unknown): Promise<R> {
    const handler = this.handlers.get(commandName);
    if (!handler) throw new Error(`Sin handler para: ${commandName}`);
    return handler.handle(command) as Promise<R>;
  }
}
```

## Registro y uso en Fastify

```typescript
// server.ts
const bus = new CommandBus();

// Registrar handlers al arrancar
bus.register("CrearPedido",    new CrearPedidoHandler(pedidoRepo, productoRepo));
bus.register("CancelarPedido", new CancelarPedidoHandler(pedidoRepo));
bus.register("ListarPedidos",  new ListarPedidosHandler(db()));

// Decorar Fastify para acceder desde las rutas
app.decorate("bus", bus);

// Ruta usando el bus
app.post("/api/pedidos", async (req, reply) => {
  const id = await app.bus.dispatch<string>("CrearPedido", req.body);
  return reply.code(201).send({ id });
});
```

## Bus con middleware de logging

```typescript
export class CommandBus {
  private handlers = new Map<string, Handler<any, any>>();
  private middlewares: Array<(name: string, cmd: unknown, next: () => Promise<unknown>) => Promise<unknown>> = [];

  use(mw: (name: string, cmd: unknown, next: () => Promise<unknown>) => Promise<unknown>) {
    this.middlewares.push(mw);
  }

  async dispatch<R>(name: string, command: unknown): Promise<R> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Sin handler para: ${name}`);

    let idx = 0;
    const next = (): Promise<unknown> => {
      const mw = this.middlewares[idx++];
      return mw ? mw(name, command, next) : handler.handle(command);
    };
    return next() as Promise<R>;
  }
}

// Middleware de logging
bus.use(async (name, cmd, next) => {
  console.log(`[bus] → ${name}`, cmd);
  const result = await next();
  console.log(`[bus] ✓ ${name}`);
  return result;
});
```

## Cuándo NO usar el Bus
- Proyectos pequeños: instanciar el handler directamente en la ruta es más simple
- Solo añade el bus cuando tengas 5+ commands o necesites middleware transversal
