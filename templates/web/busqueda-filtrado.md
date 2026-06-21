# Template: búsqueda y filtrado en servidor (composable + barra + backend)

**tags:** vue3, busqueda, filtro, paginacion | **Cuándo usar:** listados grandes (filtrado en servidor).
Para listas pequeñas filtra en cliente con `library/ui/vue-tabla-lista.md`. Criterio en
`library/ui/busqueda-filtrado.md`.

## Composable: useFiltrado (estado + debounce + querystring)

```ts
// composables/useFiltrado.ts
import { reactive } from "vue";

// Estado de filtros + debounce de la búsqueda por texto. `cargar` consulta al servidor.
export function useFiltrado<T extends Record<string, string>>(inicial: T, cargar: () => void) {
  const filtro = reactive({ ...inicial });
  let t: ReturnType<typeof setTimeout>;
  function buscar(): void { clearTimeout(t); t = setTimeout(cargar, 300); } // texto: con retardo
  function aplicar(): void { cargar(); }                                    // selects/fechas: al instante
  function limpiar(): void { Object.assign(filtro, inicial); cargar(); }
  function querystring(): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtro)) if (v) p.set(k, String(v));
    return p.toString();
  }
  return { filtro, buscar, aplicar, limpiar, querystring };
}
```

## FilterBar.vue (barra reutilizable; los filtros extra van por slot)

```vue
<!-- components/FilterBar.vue -->
<script setup lang="ts">
defineProps<{ texto: string; total?: number }>();
const emit = defineEmits<{ "update:texto": [v: string]; buscar: []; limpiar: [] }>();
</script>

<template>
  <div class="filtro no-print">
    <input class="input" :value="texto" placeholder="Buscar…"
           @input="emit('update:texto', ($event.target as HTMLInputElement).value); emit('buscar')" />
    <slot />
    <button class="btn" @click="emit('limpiar')">Limpiar</button>
    <span v-if="total != null" class="muted">{{ total }} resultado(s)</span>
  </div>
</template>

<style scoped>
.filtro { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
</style>
```

## Uso en una vista de listado

```vue
<!-- views/ProductosView.vue -->
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../lib/api";
import FilterBar from "../components/FilterBar.vue";
import { useFiltrado } from "../composables/useFiltrado";

interface Producto { id: string; nombre: string; categoria: string }
const items = ref<Producto[]>([]);
const total = ref(0);

async function cargar() {
  const r = await api<{ total: number; items: Producto[] }>(`/productos?${querystring()}`);
  items.value = r.items;
  total.value = r.total;
}
const { filtro, buscar, aplicar, limpiar, querystring } = useFiltrado({ q: "", categoria: "" }, cargar);
onMounted(cargar);
</script>

<template>
  <section class="card">
    <FilterBar v-model:texto="filtro.q" :total="total" @buscar="buscar" @limpiar="limpiar">
      <select class="select" v-model="filtro.categoria" @change="aplicar">
        <option value="">Todas las categorías</option>
        <option value="a">Categoría A</option><option value="b">Categoría B</option>
      </select>
    </FilterBar>
    <ul><li v-for="p in items" :key="p.id">{{ p.nombre }} — {{ p.categoria }}</li></ul>
  </section>
</template>
```

## Backend: consulta paginada y filtrada (parámetros, nunca concatenar valores)

```ts
// GET /api/productos?q=&categoria=&pagina=&limite=
app.get("/api/productos", async (req) => {
  const x = req.query as Record<string, string | undefined>;
  const lim = Math.min(100, Math.max(1, Number(x.limite ?? 50)));
  const pag = Math.max(1, Number(x.pagina ?? 1));
  const cond = [];
  const vals = [];
  if (x.q) { cond.push("nombre LIKE ?"); vals.push(`%${x.q}%`); }
  if (x.categoria) { cond.push("categoria = ?"); vals.push(x.categoria); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM productos ${where}`).get(...vals).n;
  const items = getDb().prepare(`SELECT * FROM productos ${where} ORDER BY nombre LIMIT ? OFFSET ?`)
    .all(...vals, lim, (pag - 1) * lim);
  return { total, pagina: pag, limite: lim, items };
});
```

Conserva los filtros en la URL si quieres que recargar/compartir mantenga el estado (ver guía).
