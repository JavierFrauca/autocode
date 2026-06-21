# Template: Test unitario de un handler (application)

**tags:** test, vitest, handler, unit, dominio
**transversal:** true

Prueba la lógica de negocio SIN BD ni red: fakes en memoria que implementan los puertos. Copia y reemplaza "Pedido" por tu caso de uso.

```typescript
// tests/crear-pedido.test.ts
import { describe, expect, it } from "vitest";
import { CrearPedidoHandler } from "../src/application/commands/CrearPedido.handler.js";

// Fakes en memoria que implementan los PUERTOS del dominio.
class InMemoryPedidoRepository {
  constructor(public items: any[] = []) {}
  async findById(id: string) { return this.items.find((p) => p.id === id) ?? null; }
  async findAll() { return { items: this.items, total: this.items.length }; }
  async save(p: any) { this.items = [...this.items.filter((x) => x.id !== p.id), p]; }
  async delete(id: string) { this.items = this.items.filter((x) => x.id !== id); }
}
class InMemoryProductoRepository {
  constructor(public items: any[] = []) {}
  async findById(id: string) { return this.items.find((p) => p.id === id) ?? null; }
}
const fakeEmail = () => ({ enviarConfirmacion: async () => {} });

describe("CrearPedido", () => {
  it("crea un pedido válido y devuelve su id", async () => {
    const productos = new InMemoryProductoRepository([{ id: "p1", stock: 5 }]);
    const handler = new CrearPedidoHandler(new InMemoryPedidoRepository(), productos, fakeEmail());

    const res = await handler.handle({ clienteId: "c1", lineas: [{ productoId: "p1", cantidad: 2 }] });

    expect(res.ok).toBe(true);
  });

  it("rechaza si no hay stock suficiente", async () => {
    const productos = new InMemoryProductoRepository([{ id: "p1", stock: 0 }]);
    const handler = new CrearPedidoHandler(new InMemoryPedidoRepository(), productos, fakeEmail());

    const res = await handler.handle({ clienteId: "c1", lineas: [{ productoId: "p1", cantidad: 1 }] });

    expect(res.ok).toBe(false);
  });
});
```

Notas:
- No abras conexiones reales: el handler solo conoce **puertos** (interfaces), nunca implementaciones concretas. Por eso un fake en memoria basta.
- Afirma sobre el `Result` (`res.ok`), no sobre los métodos internos del handler.
