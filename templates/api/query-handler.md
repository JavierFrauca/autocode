# Template: Query Handler

**tags:** cqrs, query, handler, typescript, drizzle
**transversal:** true

Reemplaza `Entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/queries/ListarEntidadesQuery.ts
import { and, asc, count, desc, eq, like } from "drizzle-orm";
import type { DrizzleDb } from "../db/client.js";
import { entidades, usuarios } from "../db/schema.js";

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface ListarEntidadesQuery {
  busqueda?:  string;
  usuarioId?: string;
  pagina?:    number;
  porPagina?: number;
  orden?:     "nombre" | "creadoEn";
  direccion?: "asc" | "desc";
}

export interface EntidadResumen {
  id:            string;
  nombre:        string;
  descripcion:   string | null;
  usuarioNombre: string;
  creadoEn:      string;
}

export interface ListarEntidadesResult {
  items:       EntidadResumen[];
  total:       number;
  pagina:      number;
  porPagina:   number;
  totalPaginas: number;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export class ListarEntidadesHandler {
  constructor(private db: DrizzleDb) {}

  async handle(q: ListarEntidadesQuery): Promise<ListarEntidadesResult> {
    const pagina    = Math.max(1, q.pagina ?? 1);
    const porPagina = Math.min(q.porPagina ?? 20, 100);
    const offset    = (pagina - 1) * porPagina;

    // Construir filtros dinámicos
    const conditions = [];
    if (q.busqueda)  conditions.push(like(entidades.nombre, `%${q.busqueda}%`));
    if (q.usuarioId) conditions.push(eq(entidades.usuarioId, q.usuarioId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Orden
    const col    = q.orden === "nombre" ? entidades.nombre : entidades.creadoEn;
    const orderBy = q.direccion === "asc" ? asc(col) : desc(col);

    // Ejecutar en paralelo: items + total
    const [items, [{ value: total }]] = await Promise.all([
      this.db
        .select({
          id:            entidades.id,
          nombre:        entidades.nombre,
          descripcion:   entidades.descripcion,
          usuarioNombre: usuarios.nombre,
          creadoEn:      entidades.creadoEn,
        })
        .from(entidades)
        .leftJoin(usuarios, eq(entidades.usuarioId, usuarios.id))
        .where(where)
        .orderBy(orderBy)
        .limit(porPagina)
        .offset(offset),
      this.db.select({ value: count() }).from(entidades).where(where),
    ]);

    return { items, total, pagina, porPagina, totalPaginas: Math.ceil(total / porPagina) };
  }
}
```

```typescript
// src/queries/ObtenerEntidadQuery.ts
export interface EntidadDetalle {
  id:          string;
  nombre:      string;
  descripcion: string | null;
  usuarioId:   string;
  creadoEn:    string;
  actualizadoEn: string;
  // relaciones expandidas si las hay
}

export class ObtenerEntidadHandler {
  constructor(private repo: EntidadRepository) {}

  async handle(id: string): Promise<EntidadDetalle | null> {
    return this.repo.findById(id);
  }
}
```
