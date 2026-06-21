# Template: Vue 3 Vista CRUD completa

**tags:** vue3, crud, typescript, list, form
**transversal:** true

```vue
<!-- src/web/views/EntidadesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from "vue";

const API = import.meta.env.VITE_API_URL ?? "";

interface Entidad { id: string; nombre: string }

const items = ref<Entidad[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showForm = ref(false);
const editing = ref<Entidad | null>(null);
const formNombre = ref("");

async function load() {
  loading.value = true; error.value = null;
  try {
    const r = await fetch(`${API}/api/entidades`);
    items.value = await r.json();
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

function openCreate() { editing.value = null; formNombre.value = ""; showForm.value = true; }
function openEdit(item: Entidad) { editing.value = item; formNombre.value = item.nombre; showForm.value = true; }

async function save() {
  const body = { nombre: formNombre.value };
  const url = editing.value ? `${API}/api/entidades/${editing.value.id}` : `${API}/api/entidades`;
  const method = editing.value ? "PUT" : "POST";
  await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  showForm.value = false;
  await load();
}

async function remove(id: string) {
  if (!confirm("¿Confirmar borrado?")) return;
  await fetch(`${API}/api/entidades/${id}`, { method: "DELETE" });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="toolbar">
      <h1>Entidades</h1>
      <button @click="openCreate">+ Nuevo</button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="loading">Cargando…</div>

    <div v-if="showForm" class="form-overlay">
      <div class="form-box">
        <h2>{{ editing ? "Editar" : "Nuevo" }}</h2>
        <input v-model="formNombre" placeholder="Nombre" @keydown.enter="save" autofocus />
        <div class="form-actions">
          <button @click="save">Guardar</button>
          <button @click="showForm = false">Cancelar</button>
        </div>
      </div>
    </div>

    <table class="table">
      <thead><tr><th>Nombre</th><th>Acciones</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.nombre }}</td>
          <td>
            <button @click="openEdit(item)">Editar</button>
            <button @click="remove(item.id)">Borrar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```
