# Transacciones con Drizzle ORM

**Categoría:** persistencia | **Cuándo usar:** Cualquier operación que modifica varias tablas y debe ser atómica (todo o nada).

## SQLite (better-sqlite3 + Drizzle)

```typescript
// SQLite tiene transacciones síncronas vía better-sqlite3
import { db } from "../db/client.js";

export class CrearPedidoHandler {
  async handle(cmd: CrearPedidoCommand): Promise<string> {
    const id = ulid().toLowerCase();

    // db().transaction() ejecuta todo en una sola transacción
    await db().transaction(async (tx) => {
      // Usar tx en vez de db() dentro de la transacción
      await tx.insert(pedidos).values({
        id,
        clienteId: cmd.clienteId,
        estado: "pendiente",
        total: calcularTotal(cmd.lineas),
        creadoEn: new Date().toISOString(),
      });

      for (const linea of cmd.lineas) {
        await tx.insert(lineasPedido).values({
          id: ulid().toLowerCase(),
          pedidoId: id,
          productoId: linea.productoId,
          cantidad: linea.cantidad,
          precioUnitario: linea.precio,
        });

        // Decrementar stock en la misma transacción
        await tx
          .update(productos)
          .set({ stock: sql`stock - ${linea.cantidad}` })
          .where(eq(productos.id, linea.productoId));
      }
    });

    return id;
  }
}
```

## PostgreSQL (postgres-js + Drizzle)

```typescript
// PostgreSQL también usa db().transaction()
await db().transaction(async (tx) => {
  const [cliente] = await tx
    .insert(clientes)
    .values({ id: ulid(), ...cmd })
    .returning();

  await tx.insert(configuraciones).values({
    clienteId: cliente.id,
    notificaciones: true,
  });
});
```

## Rollback explícito

```typescript
await db().transaction(async (tx) => {
  await tx.insert(pagos).values({ id, monto: cmd.monto });

  const saldo = await obtenerSaldo(tx, cmd.cuentaId);
  if (saldo < cmd.monto) {
    // Lanzar dentro de la transacción hace rollback automático
    throw new Error("NEGOCIO: Saldo insuficiente");
  }

  await tx.update(cuentas)
    .set({ saldo: sql`saldo - ${cmd.monto}` })
    .where(eq(cuentas.id, cmd.cuentaId));
});
```

## Pasar tx a repositorios

```typescript
// Repository que acepta tx opcional
export class PedidoRepository {
  async create(data: NuevoPedido, tx?: DrizzleTransaction): Promise<Pedido> {
    const client = tx ?? db();
    const [row] = await client.insert(pedidos).values(data).returning();
    return row;
  }
}

// Uso en handler con transacción
await db().transaction(async (tx) => {
  await pedidoRepo.create(pedidoData, tx);
  await stockRepo.decrementar(lineas, tx);
});
```

## Savepoints (PostgreSQL)

```typescript
// Operaciones opcionales dentro de la transacción
await db().transaction(async (tx) => {
  await tx.insert(pedidos).values(pedidoData);

  try {
    // Intentar operación no crítica
    await tx.insert(auditoria).values({ accion: "crear_pedido" });
  } catch {
    // Si falla la auditoría, el pedido sigue adelante (savepoint implícito)
  }
});
```

## Regla de oro
Siempre que una petición HTTP modifique más de una tabla, envuélvelo en una transacción.
