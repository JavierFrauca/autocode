# Pruebas con Vitest — patrones y qué espera el QA

**Categoría:** testing | **Cuándo usar:** SIEMPRE. Toda app generada se valida ejecutando pruebas reales; el agente debe escribir/mantener código que las haga pasar.

## Por qué importa
El veredicto de "terminado" NO es la opinión del modelo: es **vitest en verde**. Las pruebas viven en `tests/` y son **propiedad de QA** — el agente NO las edita, hace que su código las satisfaga. Una entrega sin pruebas que pasen no se acepta.

## Estructura de un test (AAA)
Arrange (prepara) → Act (ejecuta) → Assert (comprueba). Un test = un comportamiento observable, nombrado en lenguaje de negocio.

```typescript
import { describe, expect, it } from "vitest";
import { CrearPedidoHandler } from "../src/application/commands/CrearPedido.handler.js";
import { InMemoryPedidoRepository } from "./fakes/InMemoryPedidoRepository.js";

describe("CrearPedido", () => {
  it("rechaza un pedido sin stock suficiente", async () => {
    // Arrange
    const productos = new InMemoryProductoRepository([{ id: "p1", stock: 0 }]);
    const handler = new CrearPedidoHandler(new InMemoryPedidoRepository(), productos, fakeEmail());
    // Act
    const res = await handler.handle({ clienteId: "c1", lineas: [{ productoId: "p1", cantidad: 1 }] });
    // Assert
    expect(res.ok).toBe(false);
  });
});
```

## Los tres niveles (de barato a caro)
1. **Dominio / handler (unitario)** — la mayoría. Sin BD ni red: usa repos en memoria (fakes) que implementan el puerto. Rápido y estable. → `templates/api/test-handler`
2. **Ruta / IPC (integración)** — el adaptador de entrada. En servidor, `app.inject` de Fastify (sin abrir puerto). En Electron, llama al handler que registra el IPC. → `templates/api/test-route`
3. **Componente (UI)** — render con `@vue/test-utils` sobre jsdom. → `templates/web/test-component`

## Reglas de oro
- **Prueba comportamiento, no implementación.** Afirma sobre lo que entra/sale, no sobre métodos privados.
- **Determinismo.** Nada de `Date.now()` / `Math.random()` / red sin controlar: inyéctalos como dependencia.
- **Un fallo = un motivo.** Si un test puede fallar por dos razones, divídelo.
- **Fakes en memoria > mocks.** Implementar el puerto (`PedidoRepository`) en memoria es más robusto que espiar llamadas.
- **No toques `tests/`** salvo fixtures que QA permita: tu trabajo es el código de `src/`.

## Fake de un repositorio (implementa el puerto)
```typescript
// tests/fakes/InMemoryPedidoRepository.ts
import type { Pedido } from "../../src/domain/entities/Pedido.js";
import type { PedidoRepository } from "../../src/domain/ports/PedidoRepository.js";

export class InMemoryPedidoRepository implements PedidoRepository {
  constructor(private items: Pedido[] = []) {}
  async findById(id: string): Promise<Pedido | null> {
    return this.items.find((p) => p.id === id) ?? null;
  }
  async findAll(): Promise<{ items: Pedido[]; total: number }> {
    return { items: this.items, total: this.items.length };
  }
  async save(p: Pedido): Promise<void> {
    this.items = [...this.items.filter((x) => x.id !== p.id), p];
  }
  async delete(id: string): Promise<void> {
    this.items = this.items.filter((x) => x.id !== id);
  }
}
```

## Cómo se ejecutan
`npm test` → `vitest run`. El GATE del agente builder corre exactamente esto en aislamiento (Docker si está disponible) y exige `total > 0` y `failed === 0`. Ver `library/arquitectura/result-type` para afirmar sobre `Result` sin lanzar excepciones.
