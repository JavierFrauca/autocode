# Template: Domain Event

**tags:** events, domain-event, typescript
**transversal:** true

```typescript
// src/events/EntidadEvents.ts
import type { DomainEvent } from "./EventBus.js";

export interface EntidadCreadaEvent extends DomainEvent {
  readonly type: "EntidadCreada";
  readonly entidadId:  string;
  readonly nombre:     string;
  readonly usuarioId:  string;
}

export interface EntidadActualizadaEvent extends DomainEvent {
  readonly type: "EntidadActualizada";
  readonly entidadId:  string;
  readonly cambios:    Record<string, unknown>;
}

export interface EntidadEliminadaEvent extends DomainEvent {
  readonly type: "EntidadEliminada";
  readonly entidadId: string;
}
```

```typescript
// src/events/EventBus.ts — singleton compartido
import { EventEmitter } from "node:events";

export interface DomainEvent {
  readonly type:       string;
  readonly occurredAt: Date;
}

class EventBus extends EventEmitter {
  publish<E extends DomainEvent>(event: E): void {
    this.emit(event.type, event);
  }
  subscribe<E extends DomainEvent>(type: string, fn: (e: E) => void | Promise<void>): void {
    this.on(type, fn);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
```

```typescript
// src/listeners/EntidadListeners.ts — registrar en server.ts con import
import { eventBus } from "../events/EventBus.js";
import type { EntidadCreadaEvent, EntidadEliminadaEvent } from "../events/EntidadEvents.js";

eventBus.subscribe<EntidadCreadaEvent>("EntidadCreada", async (e) => {
  // Efecto secundario 1: log de auditoría
  console.log(`[audit] EntidadCreada id=${e.entidadId} por user=${e.usuarioId}`);
  // await auditoriaRepo.insert({ tipo: "EntidadCreada", ...e });
});

eventBus.subscribe<EntidadCreadaEvent>("EntidadCreada", async (e) => {
  // Efecto secundario 2: notificación WebSocket
  // notificarUsuario(e.usuarioId, { type: "EntidadCreada", nombre: e.nombre });
});

eventBus.subscribe<EntidadEliminadaEvent>("EntidadEliminada", async (e) => {
  // Limpiar recursos relacionados
  // await ficheroRepo.deleteByEntidadId(e.entidadId);
});
```

```typescript
// En el Command Handler — publicar el evento tras persistir
import { eventBus } from "../events/EventBus.js";
import type { EntidadCreadaEvent } from "../events/EntidadEvents.js";

export class CrearEntidadHandler {
  async handle(cmd: CrearEntidadCommand): Promise<string> {
    const id = ulid().toLowerCase();
    await this.repo.create({ id, ...cmd });

    eventBus.publish<EntidadCreadaEvent>({
      type:       "EntidadCreada",
      occurredAt: new Date(),
      entidadId:  id,
      nombre:     cmd.nombre,
      usuarioId:  cmd.usuarioId,
    });

    return id;
  }
}
```

```typescript
// src/server.ts — activar listeners con el import (efecto de lado)
import "./listeners/EntidadListeners.js";
```
