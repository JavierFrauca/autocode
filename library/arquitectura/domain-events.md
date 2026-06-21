# Domain Events — comunicación desacoplada entre módulos

**Categoría:** arquitectura | **Cuándo usar:** Cuando una acción en un módulo debe disparar efectos en otros módulos sin que se conozcan entre sí (envío de email al crear pedido, actualizar stock al cancelar, etc.)

## Concepto
Un Domain Event es un hecho ocurrido en el pasado expresado como objeto. El emisor no sabe quién lo escucha. Los listeners reaccionan de forma asíncrona.

## Definición de eventos

```typescript
// events/PedidoEvents.ts
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

export interface PedidoCreadoEvent extends DomainEvent {
  readonly type: "PedidoCreado";
  readonly pedidoId: string;
  readonly clienteId: string;
  readonly total: number;
}

export interface PedidoCanceladoEvent extends DomainEvent {
  readonly type: "PedidoCancelado";
  readonly pedidoId: string;
  readonly motivo: string;
}
```

## Event Bus con Node.js EventEmitter

```typescript
// events/EventBus.ts
import { EventEmitter } from "node:events";

type Listener<E> = (event: E) => Promise<void> | void;

class EventBus extends EventEmitter {
  publish<E extends DomainEvent>(event: E): void {
    this.emit(event.type, event);
  }

  subscribe<E extends DomainEvent>(type: string, listener: Listener<E>): void {
    this.on(type, listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
```

## Uso en un Command Handler

```typescript
// El handler publica el evento DESPUÉS de persistir
export class CrearPedidoHandler {
  constructor(
    private pedidoRepo: PedidoRepository,
    private events: EventBus,
  ) {}

  async handle(cmd: CrearPedidoCommand): Promise<string> {
    const id = ulid().toLowerCase();
    await this.pedidoRepo.create({ id, ...cmd });

    // Publicar evento — los listeners deciden qué hacer
    this.events.publish<PedidoCreadoEvent>({
      type: "PedidoCreado",
      occurredAt: new Date(),
      pedidoId: id,
      clienteId: cmd.clienteId,
      total: calcularTotal(cmd.lineas),
    });

    return id;
  }
}
```

## Listeners (suscriptores)

```typescript
// listeners/NotificarClienteListener.ts
eventBus.subscribe<PedidoCreadoEvent>("PedidoCreado", async (event) => {
  await emailService.enviar({
    para: await clienteRepo.getEmail(event.clienteId),
    asunto: "Pedido recibido",
    cuerpo: `Tu pedido ${event.pedidoId} está en proceso.`,
  });
});

// listeners/ActualizarStockListener.ts
eventBus.subscribe<PedidoCreadoEvent>("PedidoCreado", async (event) => {
  const pedido = await pedidoRepo.findById(event.pedidoId);
  for (const linea of pedido.lineas) {
    await productoRepo.decrementarStock(linea.productoId, linea.cantidad);
  }
});
```

## Registro al arrancar el servidor

```typescript
// server.ts o listeners/index.ts
import "./listeners/NotificarClienteListener.js";
import "./listeners/ActualizarStockListener.js";
// Los imports ejecutan el subscribe automáticamente
```

## Consideraciones

- Los eventos son **síncronos** con EventEmitter (misma petición). Para asíncrono real, usar una cola (BullMQ, etc.)
- Si el listener falla, no deshace el command — los efectos secundarios van aparte
- Para eventos críticos (facturación, contabilidad), persistir el evento en una tabla `domain_events` antes de emitirlo
- Nombre del evento: pasado del verbo → `PedidoCreado`, `UsuarioRegistrado`, `PagoFallido`
