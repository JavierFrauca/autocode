# Vue Composable — lógica reutilizable con estado reactivo

**Categoría:** ui | **Cuándo usar:** Lógica que se repite en varios componentes: peticiones HTTP, formularios, paginación, temporizadores.

## Composable para petición HTTP (useAsync)

```typescript
// composables/useAsync.ts
import { ref } from "vue";

export function useAsync<T>(fn: (...args: any[]) => Promise<T>) {
  const data     = ref<T | null>(null);
  const cargando = ref(false);
  const error    = ref<string | null>(null);

  async function ejecutar(...args: any[]): Promise<T | null> {
    cargando.value = true;
    error.value    = null;
    try {
      data.value = await fn(...args);
      return data.value;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? e.message ?? "Error desconocido";
      return null;
    } finally {
      cargando.value = false;
    }
  }

  return { data, cargando, error, ejecutar };
}
```

## Composable específico de recurso

```typescript
// composables/usePedido.ts
import { ref } from "vue";
import { api } from "../api.js";
import type { Pedido } from "@shared/types.js";

export function usePedido(id: string) {
  const pedido   = ref<Pedido | null>(null);
  const cargando = ref(false);
  const error    = ref<string | null>(null);

  async function cargar() {
    cargando.value = true;
    error.value    = null;
    try {
      const res = await api.get(`/api/pedidos/${id}`);
      pedido.value = res.data;
    } catch (e: any) {
      error.value = e.response?.status === 404 ? "Pedido no encontrado" : "Error al cargar";
    } finally {
      cargando.value = false;
    }
  }

  async function cancelar(): Promise<boolean> {
    try {
      await api.delete(`/api/pedidos/${id}`);
      return true;
    } catch {
      error.value = "No se pudo cancelar";
      return false;
    }
  }

  return { pedido, cargando, error, cargar, cancelar };
}
```

## Uso en componente

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { usePedido } from "../composables/usePedido.js";

const props = defineProps<{ id: string }>();
const { pedido, cargando, error, cargar, cancelar } = usePedido(props.id);

onMounted(cargar);

async function handleCancelar() {
  const ok = await cancelar();
  if (ok) router.push("/pedidos");
}
</script>
```

## Composable de formulario

```typescript
// composables/useForm.ts
import { ref, reactive } from "vue";
import { z, type ZodSchema } from "zod";

export function useForm<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
  initialValues: Partial<T> = {},
) {
  const fields = reactive<Partial<T>>({ ...initialValues });
  const errores = ref<Partial<Record<keyof T, string>>>({});
  const enviando = ref(false);

  function validar(): fields is T {
    const result = schema.safeParse(fields);
    if (result.success) {
      errores.value = {};
      return true;
    }
    const flat = result.error.flatten().fieldErrors;
    errores.value = Object.fromEntries(
      Object.entries(flat).map(([k, v]) => [k, v?.[0]])
    ) as any;
    return false;
  }

  async function enviar(onSubmit: (data: T) => Promise<void>) {
    if (!validar()) return;
    enviando.value = true;
    try {
      await onSubmit(fields as T);
    } finally {
      enviando.value = false;
    }
  }

  function reset() {
    Object.assign(fields, initialValues);
    errores.value = {};
  }

  return { fields, errores, enviando, validar, enviar, reset };
}
```

## Uso del composable de formulario

```vue
<script setup lang="ts">
import { z } from "zod";
import { useForm } from "../composables/useForm.js";
import { usePedidosStore } from "../stores/pedidosStore.js";

const schema = z.object({
  clienteId: z.string().min(1, "Requerido"),
  direccion: z.string().min(5, "Dirección demasiado corta"),
});

const store = usePedidosStore();
const { fields, errores, enviando, enviar } = useForm(schema);

const handleSubmit = () =>
  enviar(async (data) => {
    const id = await store.crear(data);
    if (id) router.push(`/pedidos/${id}`);
  });
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <input v-model="fields.direccion" />
    <span v-if="errores.direccion" class="error">{{ errores.direccion }}</span>
    <button :disabled="enviando" type="submit">
      {{ enviando ? "Guardando..." : "Crear pedido" }}
    </button>
  </form>
</template>
```
