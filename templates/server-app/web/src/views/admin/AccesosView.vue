<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../lib/api";

// Visor del REGISTRO DE ACCESOS / auditoría (solo admin). Imprimible (botón usa window.print; el CSS de
// impresión del tema oculta menú/barra/botones). Viene de serie con el login/auditoría.
interface Acceso {
  id: string; usuarioId: string | null; accion: string; recurso: string; resultado: string; ip: string | null; creado: string;
}

const items = ref<Acceso[]>([]);
const total = ref(0);
const filtro = ref({ accion: "", resultado: "" });
const cargando = ref(true);

async function cargar(): Promise<void> {
  cargando.value = true;
  const qs = new URLSearchParams();
  if (filtro.value.accion) qs.set("accion", filtro.value.accion);
  if (filtro.value.resultado) qs.set("resultado", filtro.value.resultado);
  try {
    const r = await api<{ total: number; items: Acceso[] }>(`/auth/accesos?${qs.toString()}`);
    items.value = r.items;
    total.value = r.total;
  } finally {
    cargando.value = false;
  }
}
function imprimir(): void { window.print(); }
onMounted(cargar);
</script>

<template>
  <section class="card">
    <div class="barra no-print">
      <h2>Registro de accesos</h2>
      <div class="filtros">
        <input class="input" v-model="filtro.accion" placeholder="Acción (p.ej. usuario.login)" @keyup.enter="cargar" />
        <select class="select" v-model="filtro.resultado">
          <option value="">Todos</option><option value="ok">ok</option><option value="denegado">denegado</option><option value="error">error</option>
        </select>
        <button class="btn" @click="cargar">Filtrar</button>
        <button class="btn" @click="imprimir">Imprimir</button>
      </div>
    </div>

    <p v-if="cargando" class="muted">Cargando…</p>
    <template v-else>
      <p class="muted">{{ total }} registro(s)</p>
      <table class="tabla">
        <thead><tr><th>Fecha</th><th>Acción</th><th>Recurso</th><th>Resultado</th><th>Usuario</th><th>IP</th></tr></thead>
        <tbody>
          <tr v-for="a in items" :key="a.id">
            <td>{{ new Date(a.creado).toLocaleString() }}</td>
            <td>{{ a.accion }}</td>
            <td>{{ a.recurso }}</td>
            <td>{{ a.resultado }}</td>
            <td>{{ a.usuarioId ?? "—" }}</td>
            <td>{{ a.ip ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.barra { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.filtros { display: flex; gap: 8px; flex-wrap: wrap; }
.tabla { width: 100%; border-collapse: collapse; }
.tabla th, .tabla td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
</style>
