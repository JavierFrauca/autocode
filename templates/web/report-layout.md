# Template: Reporting — ReportLayout, listado y ficha imprimibles

**tags:** vue3, print, reporting, listado, ficha, pdf | **Cuándo usar:** pantallas que deben imprimirse
(listados, fichas). Criterio en `library/ui/reporting.md`. Mecanismo: `window.print()` (web y escritorio;
el diálogo del SO permite imprimir o "Guardar como PDF"). El CSS de impresión ya viene en `assets/tema.css`.

Para ESCRITORIO (Electron) es idéntico; solo cambia de dónde salen los datos (en web `lib/api`, en
escritorio `window.api`/IPC). El layout y la impresión NO cambian.

## Composable: useImprimir

```ts
// composables/useImprimir.ts
export function useImprimir() {
  // window.print() abre el diálogo del sistema (impresora o "Guardar como PDF"), igual en web y escritorio.
  function imprimir(): void {
    window.print();
  }
  return { imprimir };
}
```

## ReportLayout.vue — envoltorio de informe (cabecera de impresión + acciones)

```vue
<!-- components/ReportLayout.vue -->
<script setup lang="ts">
import { useImprimir } from "../composables/useImprimir";

defineProps<{ titulo: string; subtitulo?: string }>();
const { imprimir } = useImprimir();
</script>

<template>
  <div class="report">
    <!-- Acciones: NO se imprimen -->
    <div class="report__barra no-print">
      <slot name="acciones" />
      <button class="btn btn--primary" @click="imprimir">Imprimir</button>
    </div>
    <!-- Cabecera del informe: SOLO aparece al imprimir (en pantalla ya está la cabecera del shell) -->
    <header class="report__cabecera solo-print">
      <h1>{{ titulo }}</h1>
      <p v-if="subtitulo" class="muted">{{ subtitulo }}</p>
      <p class="report__fecha">{{ new Date().toLocaleString() }}</p>
    </header>
    <div class="report-bloque"><slot /></div>
  </div>
</template>

<style scoped>
.report__barra { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 16px; }
.report__cabecera { margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 8px; }
.report__cabecera h1 { margin: 0 0 4px; font-size: 1.4rem; }
.report__fecha { font-size: 12px; color: #444; margin: 4px 0 0; }
</style>
```

## LISTADO imprimible (tabla)

```vue
<!-- views/ClientesListadoView.vue -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import ReportLayout from "../components/ReportLayout.vue";
import { api } from "../lib/api";

interface Cliente { id: string; nombre: string; email: string; ciudad: string }
const clientes = ref<Cliente[]>([]);
onMounted(async () => { clientes.value = await api<Cliente[]>("/clientes"); });
</script>

<template>
  <ReportLayout titulo="Listado de clientes" :subtitulo="`${clientes.length} registros`">
    <table class="report-tabla">
      <thead><tr><th>Nombre</th><th>Email</th><th>Ciudad</th></tr></thead>
      <tbody>
        <tr v-for="c in clientes" :key="c.id">
          <td>{{ c.nombre }}</td><td>{{ c.email }}</td><td>{{ c.ciudad }}</td>
        </tr>
      </tbody>
    </table>
  </ReportLayout>
</template>

<style scoped>
.report-tabla { width: 100%; border-collapse: collapse; }
.report-tabla th, .report-tabla td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.report-tabla thead th { border-bottom: 2px solid var(--text); }
</style>
```

## FICHA imprimible (hoja de un registro = vista de detalle)

```vue
<!-- views/ClienteFichaView.vue -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import ReportLayout from "../components/ReportLayout.vue";
import { api } from "../lib/api";

interface Cliente { id: string; nombre: string; email: string; telefono: string; ciudad: string; notas: string }
const route = useRoute();
const cliente = ref<Cliente | null>(null);
onMounted(async () => { cliente.value = await api<Cliente>(`/clientes/${route.params.id}`); });
</script>

<template>
  <ReportLayout v-if="cliente" :titulo="`Ficha de cliente — ${cliente.nombre}`">
    <section class="ficha-seccion">
      <h2>Datos de contacto</h2>
      <dl class="ficha">
        <div><dt>Nombre</dt><dd>{{ cliente.nombre }}</dd></div>
        <div><dt>Email</dt><dd>{{ cliente.email }}</dd></div>
        <div><dt>Teléfono</dt><dd>{{ cliente.telefono }}</dd></div>
        <div><dt>Ciudad</dt><dd>{{ cliente.ciudad }}</dd></div>
      </dl>
    </section>
    <section class="ficha-seccion">
      <h2>Notas</h2>
      <p>{{ cliente.notas || "—" }}</p>
    </section>
  </ReportLayout>
</template>

<style scoped>
.ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin: 0; }
.ficha > div { display: flex; flex-direction: column; }
.ficha dt { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.ficha dd { margin: 0; font-size: 15px; }
.ficha-seccion { margin-bottom: 18px; }
.ficha-seccion h2 { font-size: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
</style>
```

## Notas

- Registra las vistas en `router.ts` y, si procede, en el menú (`AppSidebar.vue`). La ficha suele abrirse
  desde una fila del listado (`router.push('/clientes/' + id)`), no desde el menú.
- En ESCRITORIO, cambia `api(...)` por la llamada IPC (`window.api...`); el resto es idéntico.
- "Página X de Y": deja que lo añada el diálogo del navegador (ver `library/ui/reporting.md`).
