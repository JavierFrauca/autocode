# CQRS — Command Query Responsibility Segregation

**Categoría:** arquitectura | **Cuándo usar:** Dominio complejo con muchas reglas de negocio, lecturas y escrituras con patrones diferentes

## Concepto
Separar las operaciones que **modifican estado** (Commands) de las que **leen estado** (Queries).

## Implementación simple en TypeScript

```typescript
// commands/CrearReservaCommand.ts
export interface CrearReservaCommand {
  clienteId: string;
  fecha: Date;
  numeroPersonas: number;
}

export class CrearReservaHandler {
  constructor(private repo: ReservaRepository) {}

  async handle(cmd: CrearReservaCommand): Promise<string> {
    // Validar reglas de negocio
    if (cmd.numeroPersonas < 1) throw new Error("Mínimo 1 persona");
    if (cmd.fecha < new Date()) throw new Error("No se puede reservar en el pasado");

    const reserva = await this.repo.create({
      id: ulid(),
      clienteId: cmd.clienteId,
      fecha: cmd.fecha,
      numeroPersonas: cmd.numeroPersonas,
      estado: "pendiente",
    });
    return reserva.id;
  }
}

// queries/ListarReservasQuery.ts
export interface ListarReservasQuery {
  estado?: "pendiente" | "confirmada" | "cancelada";
  desde?: Date;
  hasta?: Date;
}

export class ListarReservasHandler {
  constructor(private readRepo: ReservaReadRepository) {}

  async handle(query: ListarReservasQuery) {
    return this.readRepo.findFiltered(query);
  }
}
```

## Rutas Fastify con CQRS

```typescript
// Comando
app.post("/reservas", async (req) => {
  const handler = new CrearReservaHandler(reservaRepo);
  const id = await handler.handle(req.body as CrearReservaCommand);
  return { id };
});

// Query
app.get("/reservas", async (req) => {
  const handler = new ListarReservasHandler(reservaReadRepo);
  return handler.handle(req.query as ListarReservasQuery);
});
```

## Cuándo usar CQRS
- Reglas de negocio complejas en escrituras
- Proyecciones de lectura diferentes al modelo de escritura
- Cuando la lógica de validación es extensa
- Para separar responsabilidades en equipos grandes
