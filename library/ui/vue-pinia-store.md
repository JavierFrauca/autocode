# Pinia Store — gestión de estado en Vue 3

**Categoría:** ui | **Cuándo usar:** Estado que se comparte entre múltiples componentes o vistas. No usar para estado local de un componente.

## Store básico (setup store)

```typescript
// stores/pedidosStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../api.js";
import type { Pedido, ListarPedidosQuery } from "@shared/types.js";

export const usePedidosStore = defineStore("pedidos", () => {
  // Estado
  const items      = ref<Pedido[]>([]);
  const total      = ref(0);
  const cargando   = ref(false);
  const error      = ref<string | null>(null);
  const pagina     = ref(1);
  const porPagina  = ref(20);

  // Getters
  const totalPaginas = computed(() => Math.ceil(total.value / porPagina.value));
  const hayMas       = computed(() => pagina.value < totalPaginas.value);

  // Actions
  async function listar(query: Partial<ListarPedidosQuery> = {}) {
    cargando.value = true;
    error.value    = null;
    try {
      const res = await api.get("/api/pedidos", { params: { ...query, pagina: pagina.value, porPagina: porPagina.value } });
      items.value = res.data.items;
      total.value = res.data.total;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al cargar pedidos";
    } finally {
      cargando.value = false;
    }
  }

  async function crear(data: CrearPedidoDto): Promise<string | null> {
    try {
      const res = await api.post("/api/pedidos", data);
      await listar();   // recargar lista
      return res.data.id;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al crear pedido";
      return null;
    }
  }

  async function cancelar(id: string): Promise<boolean> {
    try {
      await api.delete(`/api/pedidos/${id}`);
      items.value = items.value.filter(p => p.id !== id);
      total.value--;
      return true;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al cancelar";
      return false;
    }
  }

  function irPagina(n: number) {
    pagina.value = n;
    listar();
  }

  function resetError() { error.value = null; }

  return { items, total, cargando, error, pagina, porPagina, totalPaginas, hayMas, listar, crear, cancelar, irPagina, resetError };
});
```

## Uso en un componente Vue

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { usePedidosStore } from "../stores/pedidosStore.js";

const store = usePedidosStore();
onMounted(() => store.listar());
</script>

<template>
  <div v-if="store.cargando">Cargando...</div>
  <div v-else-if="store.error" class="error">{{ store.error }}</div>
  <table v-else>
    <tr v-for="p in store.items" :key="p.id">
      <td>{{ p.id }}</td>
      <td>{{ p.estado }}</td>
      <td><button @click="store.cancelar(p.id)">Cancelar</button></td>
    </tr>
  </table>
  <div class="paginacion">
    <button :disabled="store.pagina <= 1" @click="store.irPagina(store.pagina - 1)">Anterior</button>
    <span>{{ store.pagina }} / {{ store.totalPaginas }}</span>
    <button :disabled="!store.hayMas" @click="store.irPagina(store.pagina + 1)">Siguiente</button>
  </div>
</template>
```

## Store de autenticación (patrón common)

```typescript
export const useAuthStore = defineStore("auth", () => {
  const usuario = ref<{ id: string; nombre: string; rol: string } | null>(null);
  const token   = ref<string | null>(localStorage.getItem("token"));

  const autenticado = computed(() => !!token.value);
  const esAdmin     = computed(() => usuario.value?.rol === "admin");

  async function login(email: string, password: string) {
    const res = await api.post("/api/auth/login", { email, password });
    token.value   = res.data.token;
    usuario.value = res.data.usuario;
    localStorage.setItem("token", token.value!);
    api.defaults.headers.common["Authorization"] = `Bearer ${token.value}`;
  }

  function logout() {
    token.value   = null;
    usuario.value = null;
    localStorage.removeItem("token");
    delete api.defaults.headers.common["Authorization"];
  }

  // Restaurar token al arrancar
  if (token.value) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token.value}`;
  }

  return { usuario, token, autenticado, esAdmin, login, logout };
});
```

## Dependencias

```
npm install pinia
```

```typescript
// main.ts
import { createPinia } from "pinia";
app.use(createPinia());
```
