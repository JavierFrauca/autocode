# Queries de agregación para dashboards

**Categoría:** persistencia | **Cuándo usar:** Cálculo de métricas para dashboards: ventas por día, comparativa de periodos, top-N, acumulados, usuarios activos.

> Las queries de agregación son las más olvidadas y más difíciles de escribir bien. Este fichero tiene las recetas listas para usar con Drizzle ORM.

## Serie temporal — ventas por día (PostgreSQL)

```typescript
import { sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";

// Devuelve un punto por día aunque no haya ventas ese día (usando generate_series)
async function ventasPorDia(desde: Date, hasta: Date) {
  return db().execute(sql`
    WITH dias AS (
      SELECT generate_series(
        ${desde}::date,
        ${hasta}::date,
        '1 day'::interval
      )::date AS dia
    )
    SELECT
      d.dia::text                               AS fecha,
      COALESCE(SUM(p.total), 0)::int            AS ventas,
      COUNT(p.id)::int                          AS pedidos
    FROM dias d
    LEFT JOIN pedidos p
      ON p.creado_en::date = d.dia
      AND p.estado = 'completado'
    GROUP BY d.dia
    ORDER BY d.dia
  `);
}
```

## Serie temporal — variante SQLite

```typescript
// SQLite no tiene generate_series — generamos los días en JS
async function ventasPorDiaSqlite(desde: Date, hasta: Date) {
  const rows = await db().execute(sql`
    SELECT
      strftime('%Y-%m-%d', creado_en) AS fecha,
      SUM(total)                      AS ventas,
      COUNT(*)                        AS pedidos
    FROM pedidos
    WHERE creado_en >= ${desde.toISOString()}
      AND creado_en <= ${hasta.toISOString()}
      AND estado = 'completado'
    GROUP BY fecha
    ORDER BY fecha
  `);

  // Rellenar días sin datos con 0
  return rellenarSerie(rows as any[], desde, hasta);
}

function rellenarSerie(rows: { fecha: string; ventas: number }[], desde: Date, hasta: Date) {
  const mapa = new Map(rows.map((r) => [r.fecha, r]));
  const resultado = [];
  const cursor = new Date(desde);
  while (cursor <= hasta) {
    const key = cursor.toISOString().slice(0, 10);
    resultado.push(mapa.get(key) ?? { fecha: key, ventas: 0, pedidos: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return resultado;
}
```

## Comparativa periodo actual vs anterior

```typescript
async function comparativaPeriodo(desde: Date, hasta: Date) {
  const duracion = hasta.getTime() - desde.getTime();
  const desdeAnterior = new Date(desde.getTime() - duracion);
  const hastaAnterior = new Date(hasta.getTime() - duracion);

  const [actual, anterior] = await Promise.all([
    db().select({
      ventas:   sql<number>`COALESCE(SUM(total), 0)::int`,
      pedidos:  sql<number>`COUNT(*)::int`,
      ticket:   sql<number>`COALESCE(AVG(total), 0)::numeric(10,2)`,
    }).from(schema.pedidos)
      .where(and(
        gte(schema.pedidos.creadoEn, desde),
        lte(schema.pedidos.creadoEn, hasta),
        eq(schema.pedidos.estado, "completado"),
      )),

    db().select({
      ventas:   sql<number>`COALESCE(SUM(total), 0)::int`,
      pedidos:  sql<number>`COUNT(*)::int`,
      ticket:   sql<number>`COALESCE(AVG(total), 0)::numeric(10,2)`,
    }).from(schema.pedidos)
      .where(and(
        gte(schema.pedidos.creadoEn, desdeAnterior),
        lte(schema.pedidos.creadoEn, hastaAnterior),
        eq(schema.pedidos.estado, "completado"),
      )),
  ]);

  return {
    actual:   actual[0],
    anterior: anterior[0],
    variacion: {
      ventas:  pct(actual[0].ventas,  anterior[0].ventas),
      pedidos: pct(actual[0].pedidos, anterior[0].pedidos),
      ticket:  pct(actual[0].ticket,  anterior[0].ticket),
    },
  };
}

function pct(actual: number, anterior: number): number {
  if (anterior === 0) return actual > 0 ? 100 : 0;
  return Math.round(((actual - anterior) / anterior) * 100 * 10) / 10;
}
```

## Top-N — productos más vendidos

```typescript
async function topProductos(desde: Date, hasta: Date, limite = 10) {
  return db().select({
    productoId:  schema.lineasPedido.productoId,
    nombre:      schema.productos.nombre,
    unidades:    sql<number>`SUM(lp.cantidad)::int`,
    ingresos:    sql<number>`SUM(lp.cantidad * lp.precio)::int`,
  })
    .from(schema.lineasPedido)
    .innerJoin(schema.productos, eq(schema.lineasPedido.productoId, schema.productos.id))
    .innerJoin(schema.pedidos, eq(schema.lineasPedido.pedidoId, schema.pedidos.id))
    .where(and(
      gte(schema.pedidos.creadoEn, desde),
      lte(schema.pedidos.creadoEn, hasta),
      eq(schema.pedidos.estado, "completado"),
    ))
    .groupBy(schema.lineasPedido.productoId, schema.productos.nombre)
    .orderBy(sql`ingresos DESC`)
    .limit(limite);
}
```

## Acumulado diario (running total)

```typescript
// Suma acumulada: útil para ver el crecimiento hacia un objetivo mensual
async function acumuladoDiario(mes: number, anio: number) {
  return db().execute(sql`
    SELECT
      dia,
      ventas_dia,
      SUM(ventas_dia) OVER (ORDER BY dia)::int AS acumulado
    FROM (
      SELECT
        creado_en::date                   AS dia,
        SUM(total)::int                   AS ventas_dia
      FROM pedidos
      WHERE date_trunc('month', creado_en) = make_date(${anio}, ${mes}, 1)
        AND estado = 'completado'
      GROUP BY dia
    ) sub
    ORDER BY dia
  `);
}
```

## Usuarios activos (DAU / MAU)

```typescript
async function usuariosActivos() {
  const ahora = new Date();
  const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const hace30d = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [dau, mau] = await Promise.all([
    db().select({ count: sql<number>`COUNT(DISTINCT usuario_id)::int` })
      .from(schema.auditLog)
      .where(gte(schema.auditLog.creadoEn, hace24h)),

    db().select({ count: sql<number>`COUNT(DISTINCT usuario_id)::int` })
      .from(schema.auditLog)
      .where(gte(schema.auditLog.creadoEn, hace30d)),
  ]);

  return {
    dau: dau[0].count,
    mau: mau[0].count,
    ratio: mau[0].count > 0 ? Math.round((dau[0].count / mau[0].count) * 100) : 0,
  };
}
```

## Distribución por categoría (para dona/pie)

```typescript
async function distribucionPorCategoria(desde: Date, hasta: Date) {
  return db().select({
    categoria: schema.productos.categoria,
    total:     sql<number>`SUM(lp.cantidad * lp.precio)::int`,
  })
    .from(schema.lineasPedido)
    .innerJoin(schema.productos, eq(schema.lineasPedido.productoId, schema.productos.id))
    .innerJoin(schema.pedidos, eq(schema.lineasPedido.pedidoId, schema.pedidos.id))
    .where(and(
      gte(schema.pedidos.creadoEn, desde),
      lte(schema.pedidos.creadoEn, hasta),
    ))
    .groupBy(schema.productos.categoria)
    .orderBy(sql`total DESC`);
}
```

## Ruta que agrupa todo en una llamada (dashboard endpoint)

```typescript
// Una sola petición → todos los datos del dashboard → menos round-trips
app.get("/api/dashboard", { preHandler: requireAuth }, async (req) => {
  const { desde, hasta } = req.query as { desde: string; hasta: string };
  const d = new Date(desde);
  const h = new Date(hasta);
  h.setHours(23, 59, 59, 999); // incluir todo el día final

  const [serie, comparativa, topProds, activos] = await Promise.all([
    ventasPorDia(d, h),
    comparativaPeriodo(d, h),
    topProductos(d, h),
    usuariosActivos(),
  ]);

  return { serie, comparativa, topProductos: topProds, usuariosActivos: activos };
});
```
