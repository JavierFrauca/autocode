# Command — escritura con lógica de negocio

**Categoría:** arquitectura | **Cuándo usar:** Cualquier operación que modifica estado. Es la mitad "escribir" de CQRS.

## Concepto
Un Command es un objeto inmutable que expresa la **intención** de cambiar algo. El Handler contiene toda la lógica de negocio, validaciones y persistencia. Nunca devuelve datos ricos — solo un ID o confirmación.

## Estructura

```typescript
// commands/CrearPedidoCommand.ts
export interface CrearPedidoCommand {
  readonly clienteId: string;
  readonly lineas: Array<{ productoId: string; cantidad: number }>;
  readonly direccionEntrega: string;
}

export class CrearPedidoHandler {
  constructor(
    private pedidoRepo: PedidoRepository,
    private productoRepo: ProductoRepository,
  ) {}

  async handle(cmd: CrearPedidoCommand): Promise<string> {
    // 1. Validar reglas de negocio (no Zod — esto es dominio)
    if (cmd.lineas.length === 0) throw new Error("El pedido debe tener al menos una línea");

    // 2. Verificar disponibilidad
    for (const linea of cmd.lineas) {
      const producto = await this.productoRepo.findById(linea.productoId);
      if (!producto) throw new Error(`Producto ${linea.productoId} no existe`);
      if (producto.stock < linea.cantidad) throw new Error(`Stock insuficiente: ${producto.nombre}`);
    }

    // 3. Persistir
    const id = ulid().toLowerCase();
    await this.pedidoRepo.create({ id, ...cmd, estado: "pendiente", creadoEn: new Date() });

    // 4. Devolver solo el ID (o void)
    return id;
  }
}
```

## Ruta Fastify que lo usa

```typescript
app.post("/api/pedidos", async (req, reply) => {
  const parsed = CrearPedidoSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  // Fastify valida la entrada, el handler valida el dominio
  const handler = new CrearPedidoHandler(pedidoRepo, productoRepo);
  const id = await handler.handle(parsed.data);
  return reply.code(201).send({ id });
});
```

## Convenciones del stack

- Nombre: verbo + sustantivo en PascalCase → `CrearPedidoCommand`, `CancelarReservaCommand`
- El handler recibe dependencias por constructor (inyección manual)
- Validación de forma (tipos, requeridos) con **Zod** en la ruta
- Validación de negocio (stock, permisos, estado) en el **handler**
- Errores de negocio: `throw new Error("mensaje")` — Fastify los convierte en 500; añade un error handler global para mapearlos a 4xx si son esperados
- IDs generados con `ulid()` en el handler, nunca en el cliente

## Error handler recomendado

```typescript
app.setErrorHandler((error, _req, reply) => {
  if (error.message.startsWith("NEGOCIO:")) {
    return reply.code(422).send({ error: error.message.replace("NEGOCIO:", "").trim() });
  }
  reply.code(500).send({ error: "Error interno" });
});
// Uso en handler: throw new Error("NEGOCIO: Stock insuficiente")
```
