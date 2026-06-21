# Query — lectura sin efectos secundarios

**Categoría:** arquitectura | **Cuándo usar:** Cualquier operación que solo lee datos. Es la mitad "leer" de CQRS.

## Concepto
Una Query expresa **qué datos se quieren** con sus filtros. El Handler lee directamente de la base de datos (sin pasar por el dominio) y devuelve DTOs optimizados para la vista. Nunca modifica nada.

## Estructura

```typescript
// queries/ListarPedidosQuery.ts
export interface ListarPedidosQuery {
  clienteId?: string;
  estado?: "pendiente" | "confirmado" | "entregado" | "cancelado";
  desde?: string;   // ISO date
  hasta?: string;
  pagina?: number;
  porPagina?: number;
}

// DTO de respuesta — no es la entidad de dominio
export interface PedidoResumen {
  id: string;
  clienteNombre: string;
  total: number;
  estado: string;
  creadoEn: string;
}

export class ListarPedidosHandler {
  constructor(private db: DrizzleDb) {}

  async handle(query: ListarPedidosQuery): Promise<{ items: PedidoResumen[]; total: number }> {
    const pagina = query.pagina ?? 1;
    const porPagina = Math.min(query.porPagina ?? 20, 100);
    const offset = (pagina - 1) * porPagina;

    const conditions = [];
    if (query.clienteId) conditions.push(eq(pedidos.clienteId, query.clienteId));
    if (query.estado)    conditions.push(eq(pedidos.estado, query.estado));
    if (query.desde)     conditions.push(gte(pedidos.creadoEn, query.desde));
    if (query.hasta)     conditions.push(lte(pedidos.creadoEn, query.hasta));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ count }]] = await Promise.all([
      this.db
        .select({
          id: pedidos.id,
          clienteNombre: clientes.nombre,
          total: pedidos.total,
          estado: pedidos.estado,
          creadoEn: pedidos.creadoEn,
        })
        .from(pedidos)
        .leftJoin(clientes, eq(pedidos.clienteId, clientes.id))
        .where(where)
        .orderBy(desc(pedidos.creadoEn))
        .limit(porPagina)
        .offset(offset),
      this.db.select({ count: count() }).from(pedidos).where(where),
    ]);

    return { items, total: Number(count) };
  }
}
```

## Ruta Fastify

```typescript
app.get("/api/pedidos", async (req) => {
  const query = req.query as ListarPedidosQuery;
  const handler = new ListarPedidosHandler(db());
  return handler.handle(query);
});
```

## Convenciones del stack

- Nombre: verbo en infinitivo + sustantivo + `Query` → `ListarPedidosQuery`, `ObtenerPerfilQuery`
- Devuelve **DTOs**, no entidades de dominio
- Puede hacer JOINs directamente — no usa el Repository (es lectura optimizada)
- Paginación incluida: siempre `{ items, total }` para que el front sepa cuántas páginas hay
- `porPagina` nunca supera 100 (límite de seguridad)
- Filtros opcionales con `and(...conditions)` de Drizzle

## Query de detalle (por ID)

```typescript
export class ObtenerPedidoHandler {
  async handle(id: string): Promise<PedidoDetalle | null> {
    const rows = await db()
      .select()
      .from(pedidos)
      .leftJoin(lineasPedido, eq(lineasPedido.pedidoId, pedidos.id))
      .where(eq(pedidos.id, id));

    if (rows.length === 0) return null;

    return {
      ...rows[0].pedidos,
      lineas: rows.map(r => r.lineas_pedido).filter(Boolean),
    };
  }
}
```
