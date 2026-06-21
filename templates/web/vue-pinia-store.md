# Template: Pinia Store

**tags:** vue, pinia, store, typescript
**transversal:** true

Reemplaza `entidad` / `Entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/renderer/stores/entidadesStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../api.js";
import type { Entidad, CrearEntidadDto, PaginatedResult } from "@shared/types.js";

export const useEntidadesStore = defineStore("entidades", () => {
  // ── Estado ─────────────────────────────────────────────────────────────────
  const items      = ref<Entidad[]>([]);
  const seleccion  = ref<Entidad | null>(null);
  const total      = ref(0);
  const cargando   = ref(false);
  const guardando  = ref(false);
  const error      = ref<string | null>(null);
  const pagina     = ref(1);
  const porPagina  = ref(20);
  const filtros    = ref({ busqueda: "" });

  // ── Getters ────────────────────────────────────────────────────────────────
  const totalPaginas = computed(() => Math.ceil(total.value / porPagina.value));
  const hayResultados = computed(() => items.value.length > 0);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function listar() {
    cargando.value = true;
    error.value    = null;
    try {
      const { data } = await api.get<PaginatedResult<Entidad>>("/api/entidades", {
        params: {
          ...filtros.value,
          pagina:    pagina.value,
          porPagina: porPagina.value,
        },
      });
      items.value = data.items;
      total.value = data.total;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al cargar";
    } finally {
      cargando.value = false;
    }
  }

  async function cargarUna(id: string) {
    cargando.value = true;
    try {
      const { data } = await api.get<Entidad>(`/api/entidades/${id}`);
      seleccion.value = data;
    } catch {
      seleccion.value = null;
    } finally {
      cargando.value = false;
    }
  }

  async function crear(dto: CrearEntidadDto): Promise<string | null> {
    guardando.value = true;
    error.value     = null;
    try {
      const { data } = await api.post<{ id: string }>("/api/entidades", dto);
      await listar();   // refrescar lista
      return data.id;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al crear";
      return null;
    } finally {
      guardando.value = false;
    }
  }

  async function actualizar(id: string, dto: Partial<CrearEntidadDto>): Promise<boolean> {
    guardando.value = true;
    error.value     = null;
    try {
      const { data } = await api.put<Entidad>(`/api/entidades/${id}`, dto);
      // Actualizar en la lista local sin refetch
      const idx = items.value.findIndex(i => i.id === id);
      if (idx !== -1) items.value[idx] = data;
      if (seleccion.value?.id === id) seleccion.value = data;
      return true;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al actualizar";
      return false;
    } finally {
      guardando.value = false;
    }
  }

  async function eliminar(id: string): Promise<boolean> {
    try {
      await api.delete(`/api/entidades/${id}`);
      items.value = items.value.filter(i => i.id !== id);
      total.value--;
      if (seleccion.value?.id === id) seleccion.value = null;
      return true;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al eliminar";
      return false;
    }
  }

  function irPagina(n: number) {
    pagina.value = n;
    listar();
  }

  function buscar(texto: string) {
    filtros.value.busqueda = texto;
    pagina.value = 1;
    listar();
  }

  function resetError() { error.value = null; }

  return {
    items, seleccion, total, cargando, guardando, error,
    pagina, porPagina, filtros, totalPaginas, hayResultados,
    listar, cargarUna, crear, actualizar, eliminar, irPagina, buscar, resetError,
  };
});
```

```typescript
// src/renderer/main.ts — registrar Pinia (una sola vez)
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router.js";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
```
