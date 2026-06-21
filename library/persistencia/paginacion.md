# Paginación con Drizzle ORM

**Categoría:** persistencia | **Cuándo usar:** Cualquier listado que puede crecer. Siempre paginar — nunca devolver todos los registros sin límite.

## Paginación por offset (clásica)

```typescript
import { count, desc, and, eq } from "drizzle-orm";

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

export async function paginar<T>(
  query: { pagina?: number; porPagina?: number },
  fetchItems: (limit: number, offset: number) => Promise<T[]>,
  fetchTotal: () => Promise<number>,
): Promise<PaginatedResult<T>> {
  const pagina    = Math.max(1, query.pagina ?? 1);
  const porPagina = Math.min(query.porPagina ?? 20, 100);
  const offset    = (pagina - 1) * porPagina;

  const [items, total] = await Promise.all([
    fetchItems(porPagina, offset),
    fetchTotal(),
  ]);

  return { items, total, pagina, porPagina, totalPaginas: Math.ceil(total / porPagina) };
}

// Uso dentro de un Query Handler
export async function listarClientes(q: ListarClientesQuery) {
  return paginar(
    q,
    (limit, offset) =>
      db().select().from(clientes)
        .where(q.busqueda ? like(clientes.nombre, `%${q.busqueda}%`) : undefined)
        .orderBy(desc(clientes.creadoEn))
        .limit(limit).offset(offset),
    async () => {
      const [{ value }] = await db().select({ value: count() }).from(clientes);
      return value;
    },
  );
}
```

## Paginación por cursor (para listas en tiempo real)

Más eficiente que offset en tablas grandes. El cursor es el `id` o `creadoEn` del último elemento visto.

```typescript
export interface CursorResult<T> {
  items: T[];
  nextCursor: string | null;   // null = no hay más
}

async function listarConCursor(
  cursor: string | null,
  limite: number,
): Promise<CursorResult<Mensaje>> {
  const limit = Math.min(limite, 50);

  const rows = await db()
    .select()
    .from(mensajes)
    .where(cursor ? lt(mensajes.id, cursor) : undefined)  // anterior al cursor
    .orderBy(desc(mensajes.id))
    .limit(limit + 1);  // pedir uno más para saber si hay siguiente página

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}
```

## Respuesta HTTP recomendada

```typescript
// GET /api/clientes?pagina=2&porPagina=15
// Devuelve:
{
  "items": [...],
  "total": 243,
  "pagina": 2,
  "porPagina": 15,
  "totalPaginas": 17
}

// GET /api/mensajes?cursor=01JXYZ&limite=20
// Devuelve:
{
  "items": [...],
  "nextCursor": "01JABCD"   // el front lo manda en la siguiente petición
}
```

## Cuándo usar cada una
- **Offset**: listados con navegación por páginas (tablas, informes). Simple, funciona bien hasta ~100k filas.
- **Cursor**: feeds, chats, listas de actividad. Consistente aunque lleguen nuevos datos.
