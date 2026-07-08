# Relaciones 1:N — composición vs asociación (y el borrado en cascada)

**Categoría:** persistencia | **Cuándo usar:** siempre que una entidad del dominio (`dominios/*.md`) declare una
relación 1:N con otra. Antes de escribir el repositorio, decide si es **composición** (la hija no existe sin el
padre) o **asociación** (referencia entre entidades independientes) — el paper de dominio ya debería traer esta
distinción explícita en su sección "## Relaciones" (ver `documenter-system.md`).

## Composición (ej. Factura → Líneas)

La hija SOLO tiene sentido dentro de su padre. Al borrar el padre, se borran sus hijas. Dos formas de
implementarlo, según el motor:

**SQLite (`better-sqlite3`, sin FK activas por defecto) — borrado explícito en la misma transacción:**

```ts
// src/repos/lineasFactura.repo.ts
export class LineasFacturaRepoSqlite extends BaseRepoSqlite<LineaFactura> implements LineasFacturaRepo {
  protected readonly tabla = "lineas_factura";
  protected readonly idColumna = "id";

  listarPorFacturaId(facturaId: string): LineaFactura[] {
    return this.db().prepare("SELECT * FROM lineas_factura WHERE factura_id = ? ORDER BY orden").all(facturaId) as LineaFactura[];
  }

  /** Se llama SIEMPRE desde el borrado de la Factura (composición: la hija no sobrevive al padre). */
  borrarPorFacturaId(facturaId: string): void {
    this.db().prepare("DELETE FROM lineas_factura WHERE factura_id = ?").run(facturaId);
  }
}

// src/repos/facturas.repo.ts
export class FacturasRepoSqlite extends BaseRepoSqlite<Factura> implements FacturasRepo {
  protected readonly tabla = "facturas";
  protected readonly idColumna = "id";

  borrar(id: string): void {
    // composición: primero las hijas, luego el padre — en la misma transacción para que no quede huérfano
    this.db().transaction(() => {
      repos.lineasFactura.borrarPorFacturaId(id);
      super.borrar(id);
    })();
  }
}
```

**Postgres (si el ADR pide `**Motor:** postgres`) — `ON DELETE CASCADE` en la clave foránea:**

```sql
CREATE TABLE lineas_factura (
  id          TEXT PRIMARY KEY,
  factura_id  TEXT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  -- … resto de columnas …
);
```

Con `ON DELETE CASCADE` no hace falta el borrado explícito en la app: la propia BD elimina las líneas al
borrar la factura. Aun así, documenta la composición en el repo (comentario o método `listarPorFacturaId`)
para que quede claro en el código, no solo en el esquema.

## Asociación (ej. Pedido → Cliente)

Referencia simple: el hijo guarda el id del padre, pero **borrar uno NO borra el otro**. Si se intenta borrar
un Cliente que tiene Pedidos, dos estrategias válidas (elige según lo que diga la regla de negocio):

- **Bloquear el borrado** si hay hijos activos: `borrar(id)` comprueba primero `existenPedidosDeCliente(id)` y
  lanza un error de dominio si es `true`.
- **Desvincular** (poner la referencia a `NULL` o marcar "sin cliente activo") si el negocio lo permite — igual
  que ya hace el ejemplo de `samples/inventario/dominio/proveedores.md` al desactivar un proveedor.

```ts
export class ClientesRepoSqlite extends BaseRepoSqlite<Cliente> implements ClientesRepo {
  protected readonly tabla = "clientes";
  protected readonly idColumna = "id";

  borrar(id: string): void {
    if (repos.pedidos.existenDeCliente(id)) {
      throw new Error("No se puede borrar un cliente con pedidos existentes");
    }
    super.borrar(id);
  }
}
```

## Regla general

- **Nunca dejes registros huérfanos silenciosamente**: toda relación 1:N declarada en `dominios/*.md` debe
  resolverse EXPLÍCITAMENTE (cascada, bloqueo o desvinculación) en el repositorio del padre — no dejar el
  borrado del padre sin decidir qué pasa con sus hijas/asociados.
- El tipo (composición/asociación) sale del paper de dominio; si no está anotado, sigue el criterio por
  defecto del `documenter-system.md` (hija sin sentido fuera del padre → composición).

Relacionado: `library/arquitectura/repository.md` (base compartida `BaseRepoSqlite`).
