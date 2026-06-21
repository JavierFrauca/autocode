# Template: Vue Composable de API

**tags:** vue, composable, typescript, axios
**transversal:** true

Reemplaza `entidad` / `Entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/renderer/api.ts — cliente HTTP base (una sola vez en el proyecto)
import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:3000",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// Interceptor: añadir token automáticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Interceptor: redirigir al login si el token expira
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
```

```typescript
// src/renderer/composables/useEntidades.ts
import { ref } from "vue";
import { api } from "../api.js";
import type { Entidad, CrearEntidadDto, ListarEntidadesQuery, PaginatedResult } from "@shared/types.js";

export function useEntidades() {
  const items    = ref<Entidad[]>([]);
  const total    = ref(0);
  const cargando = ref(false);
  const error    = ref<string | null>(null);

  async function listar(query: Partial<ListarEntidadesQuery> = {}) {
    cargando.value = true;
    error.value    = null;
    try {
      const { data } = await api.get<PaginatedResult<Entidad>>("/api/entidades", { params: query });
      items.value = data.items;
      total.value = data.total;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al cargar";
    } finally {
      cargando.value = false;
    }
  }

  async function obtener(id: string): Promise<Entidad | null> {
    try {
      const { data } = await api.get<Entidad>(`/api/entidades/${id}`);
      return data;
    } catch {
      return null;
    }
  }

  async function crear(dto: CrearEntidadDto): Promise<string | null> {
    try {
      const { data } = await api.post<{ id: string }>("/api/entidades", dto);
      return data.id;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al crear";
      return null;
    }
  }

  async function actualizar(id: string, dto: Partial<CrearEntidadDto>): Promise<boolean> {
    try {
      await api.put(`/api/entidades/${id}`, dto);
      return true;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al actualizar";
      return false;
    }
  }

  async function eliminar(id: string): Promise<boolean> {
    try {
      await api.delete(`/api/entidades/${id}`);
      items.value = items.value.filter(i => i.id !== id);
      total.value--;
      return true;
    } catch (e: any) {
      error.value = e.response?.data?.error ?? "Error al eliminar";
      return false;
    }
  }

  return { items, total, cargando, error, listar, obtener, crear, actualizar, eliminar };
}
```

```typescript
// src/shared/types.ts — tipos compartidos front/back
export interface Entidad {
  id:            string;
  nombre:        string;
  descripcion:   string | null;
  usuarioNombre: string;
  creadoEn:      string;
}

export interface CrearEntidadDto {
  nombre:      string;
  descripcion?: string;
}

export interface ListarEntidadesQuery {
  busqueda?:  string;
  pagina?:    number;
  porPagina?: number;
}

export interface PaginatedResult<T> {
  items:       T[];
  total:       number;
  pagina:      number;
  porPagina:   number;
  totalPaginas: number;
}
```
