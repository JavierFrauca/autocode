# Validación con Zod (esquema único, cliente y servidor)

**Categoría:** ui | **Cuándo usar:** cualquier formulario o entrada de datos. Un mismo esquema valida en el navegador (UX inmediata) y en el backend (la frontera real).

## Idea central
Define el esquema **una vez** y reúsalo: el tipo TypeScript se **infiere** del esquema (no se duplica), el cliente da feedback al instante y el servidor nunca confía en el cliente.

## Esquema compartido
```typescript
// src/shared/pedido.schema.ts  (o duplicado en cliente y servidor si no comparten carpeta)
import { z } from "zod";

export const PedidoSchema = z.object({
  cliente: z.string().min(1, "El cliente es obligatorio"),
  email: z.string().email("Email no válido"),
  lineas: z
    .array(
      z.object({
        productoId: z.string().min(1, "Falta el producto"),
        cantidad: z.number().int().positive("La cantidad debe ser mayor que 0"),
      }),
    )
    .min(1, "Añade al menos una línea"),
});

// El tipo se INFIERE del esquema: una sola fuente de verdad.
export type PedidoInput = z.infer<typeof PedidoSchema>;
```

## En el servidor (la frontera real — Fastify)
```typescript
// src/adapters/http/pedidos.routes.ts
app.post("/api/pedidos", async (req, reply) => {
  const parsed = PedidoSchema.safeParse(req.body);
  if (!parsed.success) {
    // flatten() agrupa los mensajes por campo, listos para el cliente.
    return reply.code(400).send({ error: parsed.error.flatten().fieldErrors });
  }
  const result = await handler.handle(parsed.data); // parsed.data es PedidoInput, ya tipado
  if (!result.ok) return reply.code(422).send({ error: result.error.message });
  return reply.code(201).send({ id: result.value });
});
```

## En el cliente (UX inmediata — Vue)
```typescript
// dentro de un componente de formulario
import { reactive, ref } from "vue";
import { PedidoSchema, type PedidoInput } from "../shared/pedido.schema.js";

const form = reactive<Partial<PedidoInput>>({ cliente: "", email: "", lineas: [] });
const errores = ref<Record<string, string[]>>({});

function validar(): boolean {
  const r = PedidoSchema.safeParse(form);
  errores.value = r.success ? {} : r.error.flatten().fieldErrors as Record<string, string[]>;
  return r.success;
}

function enviar() {
  if (!validar()) return; // no llames a la API si el cliente ya sabe que es inválido
  // ... api("/pedidos", { method: "POST", body: JSON.stringify(form) })
}
```

```vue
<template>
  <input v-model="form.cliente" name="cliente" />
  <p v-if="errores.cliente" class="error">{{ errores.cliente[0] }}</p>
</template>
```

## Buenas prácticas
- **Mensajes en el esquema** (segundo argumento de cada validador) → se escriben una vez y aparecen igual en cliente y servidor.
- **`safeParse`, no `parse`** en los bordes: devuelve `{ success, error }` en vez de lanzar, y encaja con `Result` (`library/arquitectura/result-type`).
- **Nunca confíes en el cliente.** La validación de cliente es comodidad; la del servidor es seguridad. Las dos usan el mismo esquema, así que no divergen.
- **`z.infer`** para el tipo: si cambias el esquema, el tipo cambia solo y el compilador te enseña qué romper.
