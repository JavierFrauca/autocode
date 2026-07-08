# Movimientos de stock / almacén — modelo mínimo con trazabilidad

**Categoría:** dominio | **Cuándo usar:** SOLO si el dominio incluye control de inventario/almacén más allá de
un simple contador de stock en el producto. No es una pieza central del andamiaje — cárgala solo si el plan
la menciona.

## Por qué NO basta un campo `stock` en el producto

Un contador plano (`producto.stock`) no tiene trazabilidad: no se puede saber por qué cambió, ni auditarlo, ni
soportar varios almacenes. El stock real de un producto (o de un producto+almacén) es la **suma de sus
movimientos**, no un número que se sobrescribe.

## Modelo mínimo

- **Almacén** (opcional si solo hay uno): id, nombre, activo.
- **Movimiento**: id, `producto_id`, `almacen_id` (si hay varios almacenes), `tipo` (`entrada` | `salida` |
  `traspaso` | `ajuste`), `cantidad` (siempre positiva; el signo lo da el `tipo`, nunca una cantidad negativa),
  `fecha`, `motivo` (texto libre o referencia a un documento: pedido, factura, albarán), `almacen_destino_id`
  (solo si `tipo = traspaso`).

**Relación con Producto**: es **asociación**, NO composición (`library/persistencia/relaciones-padre-hijo.md`)
— los movimientos son historial/auditoría y deben sobrevivir aunque el producto se desactive. Si se intenta
borrar un producto con movimientos, bloquea el borrado (usa "activo=false", igual que ya hace
`samples/inventario/dominio/productos.md`).

## Stock actual = vista derivada, no columna mutable

```ts
// src/repos/movimientosStock.repo.ts
export class MovimientosStockRepoSqlite extends BaseRepoSqlite<MovimientoStock> implements MovimientosStockRepo {
  protected readonly tabla = "movimientos_stock";
  protected readonly idColumna = "id";

  /** Saldo actual = entradas - salidas +/- traspasos, calculado del histórico (nunca un contador aparte). */
  stockActual(productoId: string, almacenId?: string): number {
    const filtroAlmacen = almacenId ? "AND almacen_id = ?" : "";
    const params = almacenId ? [productoId, almacenId] : [productoId];
    const fila = this.db()
      .prepare(
        `SELECT COALESCE(SUM(
           CASE tipo
             WHEN 'entrada' THEN cantidad
             WHEN 'salida' THEN -cantidad
             WHEN 'ajuste' THEN cantidad  -- el signo del ajuste lo decide quien lo registra (positivo o negativo real en negocio, aquí se guarda ya con signo aplicado si se modela así)
             ELSE 0
           END
         ), 0) AS stock
         FROM movimientos_stock WHERE producto_id = ? ${filtroAlmacen}`,
      )
      .get(...params) as { stock: number };
    return fila.stock;
  }
}
```

Para "traspaso" entre almacenes: se registran DOS filas (salida del origen, entrada en destino) en la misma
transacción — nunca una sola fila con "cambia de almacén", porque rompe la trazabilidad de cada almacén.

## Evitar stock negativo (regla de negocio, no solo de UI)

```ts
crearSalida(productoId: string, almacenId: string, cantidad: number): void {
  this.db().transaction(() => {
    const actual = this.stockActual(productoId, almacenId);
    if (actual < cantidad) throw new Error("Stock insuficiente para esta salida");
    this.registrar({ productoId, almacenId, tipo: "salida", cantidad, fecha: new Date().toISOString() });
  })();
}
```

La comprobación y la inserción van en la MISMA transacción SQLite (`db.transaction(...)`) para que dos salidas
concurrentes no dejen el stock en negativo por condición de carrera.

## Reglas

- Nunca sobrescribas un contador de stock: el saldo se CALCULA del histórico de movimientos.
- Cantidad siempre positiva en la fila; el signo lo determina el `tipo`, nunca un número negativo guardado.
- Traspaso = dos movimientos (salida + entrada) en una transacción, nunca un UPDATE de "almacén actual".
- Bloquea la salida si dejaría el stock por debajo de cero (salvo que el negocio permita stock negativo
  explícitamente — en ese caso, dilo en la regla de negocio, no lo asumas).
- Los movimientos son append-only: no se editan ni se borran (una corrección se hace con un movimiento de
  `ajuste` nuevo, nunca modificando uno pasado) — es lo que da la trazabilidad real.

Relacionado: `library/persistencia/relaciones-padre-hijo.md`, `library/arquitectura/repository.md`.
