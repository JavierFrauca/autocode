# Result Type — errores sin excepciones

**Categoría:** arquitectura | **Cuándo usar:** Cuando un handler puede fallar por razones de negocio conocidas y quieres que el compilador obligue a gestionar el error.

## Concepto
En lugar de `throw`, el handler devuelve `Result<T, E>`. El caller no puede ignorar el error — TypeScript lo obliga a comprobar si es Ok o Err antes de usar el valor.

## Implementación

```typescript
// shared/Result.ts
export type Result<T, E = string> = Ok<T> | Err<E>;

export class Ok<T> {
  readonly ok = true as const;
  constructor(readonly value: T) {}
}

export class Err<E> {
  readonly ok = false as const;
  constructor(readonly error: E) {}
}

export const ok  = <T>(value: T): Ok<T>   => new Ok(value);
export const err = <E>(error: E): Err<E>  => new Err(error);
```

## Handler con Result

```typescript
// commands/RetirarStockCommand.ts
export type RetirarStockError =
  | "PRODUCTO_NO_ENCONTRADO"
  | "STOCK_INSUFICIENTE"
  | "CANTIDAD_INVALIDA";

export class RetirarStockHandler {
  async handle(cmd: RetirarStockCommand): Promise<Result<void, RetirarStockError>> {
    if (cmd.cantidad <= 0) return err("CANTIDAD_INVALIDA");

    const producto = await this.repo.findById(cmd.productoId);
    if (!producto)              return err("PRODUCTO_NO_ENCONTRADO");
    if (producto.stock < cmd.cantidad) return err("STOCK_INSUFICIENTE");

    await this.repo.decrementarStock(cmd.productoId, cmd.cantidad);
    return ok(undefined);
  }
}
```

## Ruta Fastify con Result

```typescript
app.post("/api/stock/retirar", async (req, reply) => {
  const result = await handler.handle(req.body as RetirarStockCommand);

  if (!result.ok) {
    const statusMap: Record<RetirarStockError, number> = {
      PRODUCTO_NO_ENCONTRADO: 404,
      STOCK_INSUFICIENTE:     422,
      CANTIDAD_INVALIDA:      400,
    };
    return reply.code(statusMap[result.error]).send({ error: result.error });
  }

  return reply.code(204).send();
});
```

## Ventajas sobre throw

- TypeScript fuerza el `if (!result.ok)` — imposible olvidar el caso de error
- Los errores son parte del tipo → documentación automática
- Sin try/catch en las rutas
- Fácil de testear: `expect(result.ok).toBe(false); expect(result.error).toBe("STOCK_INSUFICIENTE")`

## Cuándo seguir usando throw

- Errores inesperados (base de datos caída, null pointer): dejar que propaguen como excepciones
- Errores de infraestructura que el dominio no puede prever
- Result solo para errores de **negocio conocidos**
