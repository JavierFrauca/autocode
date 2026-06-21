# Vue 3 — Componente tabla/lista con paginación

**Categoría:** ui | **Cuándo usar:** Listar registros con búsqueda, ordenación y paginación

```vue
<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  items: any[];
  columns: { key: string; label: string; sortable?: boolean }[];
  searchKeys?: string[];
}>();

const emit = defineEmits<{ (e: "select", item: any): void }>();

const search = ref("");
const sortKey = ref("");
const sortDesc = ref(false);
const page = ref(1);
const perPage = 10;

const filtered = computed(() => {
  let list = props.items;
  if (search.value && props.searchKeys?.length) {
    const q = search.value.toLowerCase();
    list = list.filter((item) =>
      props.searchKeys!.some((k) => String(item[k] ?? "").toLowerCase().includes(q))
    );
  }
  if (sortKey.value) {
    list = [...list].sort((a, b) => {
      const v = String(a[sortKey.value]).localeCompare(String(b[sortKey.value]));
      return sortDesc.value ? -v : v;
    });
  }
  return list;
});

const total = computed(() => filtered.value.length);
const paginated = computed(() => filtered.value.slice((page.value - 1) * perPage, page.value * perPage));

function sort(key: string) {
  if (sortKey.value === key) { sortDesc.value = !sortDesc.value; }
  else { sortKey.value = key; sortDesc.value = false; }
}
</script>

<template>
  <div>
    <input v-if="searchKeys?.length" v-model="search" placeholder="Buscar…" class="search-input" />
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" @click="col.sortable && sort(col.key)">
            {{ col.label }}
            <span v-if="sortKey === col.key">{{ sortDesc ? "↓" : "↑" }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in paginated" :key="item.id" @click="emit('select', item)" class="row">
          <td v-for="col in columns" :key="col.key">{{ item[col.key] }}</td>
        </tr>
        <tr v-if="paginated.length === 0">
          <td :colspan="columns.length" class="empty">Sin resultados</td>
        </tr>
      </tbody>
    </table>
    <div class="pagination" v-if="total > perPage">
      <button :disabled="page === 1" @click="page--">‹</button>
      <span>{{ page }} / {{ Math.ceil(total / perPage) }}</span>
      <button :disabled="page >= Math.ceil(total / perPage)" @click="page++">›</button>
    </div>
  </div>
</template>
```
