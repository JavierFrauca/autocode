# Filtros de fecha para dashboards

**Categoría:** ui | **Cuándo usar:** Selector de rango temporal en dashboards: presets rápidos (hoy, 7 días, mes) + rango personalizado. Wiring con Pinia y recarga reactiva de datos.

## Store de filtros (Pinia)

```typescript
// stores/dashboardStore.ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export type Preset = "hoy" | "7d" | "30d" | "mes" | "trimestre" | "anio" | "personalizado";

export const useDashboardStore = defineStore("dashboard", () => {
  const preset = ref<Preset>("30d");
  const desdeCustom = ref<string>("");   // ISO date "2026-01-01"
  const hastaCustom = ref<string>("");

  const rango = computed(() => {
    const hoy  = new Date();
    const fin  = new Date(hoy);
    fin.setHours(23, 59, 59, 999);

    switch (preset.value) {
      case "hoy": {
        const ini = new Date(hoy); ini.setHours(0, 0, 0, 0);
        return { desde: ini, hasta: fin };
      }
      case "7d": {
        const ini = new Date(hoy); ini.setDate(ini.getDate() - 6); ini.setHours(0, 0, 0, 0);
        return { desde: ini, hasta: fin };
      }
      case "30d": {
        const ini = new Date(hoy); ini.setDate(ini.getDate() - 29); ini.setHours(0, 0, 0, 0);
        return { desde: ini, hasta: fin };
      }
      case "mes": {
        const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        return { desde: ini, hasta: fin };
      }
      case "trimestre": {
        const mesInicio = Math.floor(hoy.getMonth() / 3) * 3;
        const ini = new Date(hoy.getFullYear(), mesInicio, 1);
        return { desde: ini, hasta: fin };
      }
      case "anio": {
        const ini = new Date(hoy.getFullYear(), 0, 1);
        return { desde: ini, hasta: fin };
      }
      case "personalizado":
        return {
          desde: desdeCustom.value ? new Date(desdeCustom.value) : new Date(hoy.setDate(1)),
          hasta: hastaCustom.value ? new Date(hastaCustom.value + "T23:59:59") : fin,
        };
    }
  });

  // Formato ISO para pasar como query params a la API
  const rangoParams = computed(() => ({
    desde: rango.value.desde.toISOString(),
    hasta: rango.value.hasta.toISOString(),
  }));

  function setPreset(p: Preset) { preset.value = p; }
  function setCustom(desde: string, hasta: string) {
    desdeCustom.value = desde;
    hastaCustom.value = hasta;
    preset.value      = "personalizado";
  }

  return { preset, rango, rangoParams, desdeCustom, hastaCustom, setPreset, setCustom };
});
```

## Componente FiltroFecha.vue

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useDashboardStore } from "../stores/dashboardStore.js";
import type { Preset } from "../stores/dashboardStore.js";

const store = useDashboardStore();

const presets: { valor: Preset; label: string }[] = [
  { valor: "hoy",       label: "Hoy" },
  { valor: "7d",        label: "7 días" },
  { valor: "30d",       label: "30 días" },
  { valor: "mes",       label: "Este mes" },
  { valor: "trimestre", label: "Trimestre" },
  { valor: "anio",      label: "Este año" },
];
</script>

<template>
  <div class="filtro-fecha">
    <div class="presets">
      <button
        v-for="p in presets" :key="p.valor"
        :class="['preset-btn', { active: store.preset === p.valor }]"
        @click="store.setPreset(p.valor)"
      >{{ p.label }}</button>
    </div>

    <div class="custom-range">
      <input type="date" :value="store.desdeCustom"
        @change="store.setCustom(($event.target as HTMLInputElement).value, store.hastaCustom)" />
      <span>→</span>
      <input type="date" :value="store.hastaCustom"
        @change="store.setCustom(store.desdeCustom, ($event.target as HTMLInputElement).value)" />
    </div>
  </div>
</template>

<style scoped>
.filtro-fecha   { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.presets        { display: flex; gap: 4px; }

.preset-btn {
  padding:       5px 12px;
  border:        1px solid var(--color-border);
  border-radius: 6px;
  background:    transparent;
  cursor:        pointer;
  font-size:     13px;
  color:         var(--color-text);
  transition:    background .15s, border-color .15s;
}
.preset-btn:hover  { background: var(--color-surface-alt); }
.preset-btn.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

.custom-range {
  display:     flex;
  align-items: center;
  gap:         6px;
  font-size:   13px;
}
.custom-range input {
  border:        1px solid var(--color-border);
  border-radius: 6px;
  padding:       4px 8px;
  font-size:     13px;
  background:    var(--color-surface);
  color:         var(--color-text);
}
</style>
```

## Uso en DashboardView.vue — wiring completo

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { useDashboardStore } from "../stores/dashboardStore.js";
import FiltroFecha from "../components/FiltroFecha.vue";
import KpiCard     from "../components/KpiCard.vue";
import GraficoLineas from "../components/GraficoLineas.vue";

const store    = useDashboardStore();
const cargando = ref(true);
const datos    = ref<any>(null);

async function cargar() {
  cargando.value = true;
  try {
    const { desde, hasta } = store.rangoParams;
    const r = await fetch(`/api/dashboard?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
    datos.value = await r.json();
  } finally {
    cargando.value = false;
  }
}

// Recargar automáticamente cuando cambia el rango
watch(() => store.rangoParams, cargar, { immediate: true });
</script>

<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1>Dashboard</h1>
      <FiltroFecha />
    </header>

    <div class="kpi-grid">
      <KpiCard titulo="Ventas"   :valor="datos?.comparativa.actual.ventas  ?? 0"
               formato="euros"   :anterior="datos?.comparativa.anterior.ventas"  :cargando="cargando" icono="💰" />
      <KpiCard titulo="Pedidos"  :valor="datos?.comparativa.actual.pedidos ?? 0"
               formato="numero"  :anterior="datos?.comparativa.anterior.pedidos" :cargando="cargando" icono="📦" />
      <!-- más cards... -->
    </div>

    <GraficoLineas
      v-if="!cargando && datos?.serie"
      :datos="datos.serie"
      titulo="Ventas diarias"
    />
  </div>
</template>

<style scoped>
.dashboard        { display: flex; flex-direction: column; gap: 24px; padding: 24px; }
.dashboard-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.kpi-grid         { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
</style>
```

## Sincronizar rango con la URL (dashboards compartibles)

```typescript
// En DashboardView.vue — para que la URL refleje el filtro seleccionado
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route  = useRoute();

// Al cargar: leer parámetros de la URL
onMounted(() => {
  const p = route.query.preset as Preset;
  if (p) store.setPreset(p);
});

// Al cambiar: escribir en la URL sin recargar la página
watch(() => store.preset, (p) => {
  router.replace({ query: { ...route.query, preset: p } });
});
```
