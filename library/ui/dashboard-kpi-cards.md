# KPI Cards — tarjetas de métricas para dashboards

**Categoría:** ui | **Cuándo usar:** Mostrar métricas clave en la parte superior de un dashboard: total de ventas, usuarios activos, tasa de conversión, tickets abiertos, etc.

## Componente KpiCard.vue

```vue
<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  titulo:    string;
  valor:     number | string;
  formato?:  "numero" | "euros" | "porcentaje" | "texto";
  anterior?: number;          // valor del periodo anterior (para calcular tendencia)
  icono?:    string;          // emoji o nombre de lucide icon
  cargando?: boolean;
}>();

const valorFormateado = computed(() => {
  if (typeof props.valor !== "number") return props.valor;
  switch (props.formato) {
    case "euros":      return props.valor.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    case "porcentaje": return `${props.valor.toFixed(1)} %`;
    case "numero":
    default:           return props.valor.toLocaleString("es-ES");
  }
});

const tendencia = computed(() => {
  if (props.anterior == null || typeof props.valor !== "number" || props.anterior === 0) return null;
  const diff = ((props.valor - props.anterior) / props.anterior) * 100;
  return { valor: Math.abs(diff).toFixed(1), positiva: diff >= 0 };
});
</script>

<template>
  <div class="kpi-card" :class="{ 'kpi-card--loading': cargando }">
    <div v-if="cargando" class="kpi-skeleton">
      <div class="skel skel-titulo" />
      <div class="skel skel-valor" />
      <div class="skel skel-tend" />
    </div>

    <template v-else>
      <div class="kpi-header">
        <span class="kpi-titulo">{{ titulo }}</span>
        <span v-if="icono" class="kpi-icono">{{ icono }}</span>
      </div>

      <div class="kpi-valor">{{ valorFormateado }}</div>

      <div v-if="tendencia" class="kpi-tendencia" :class="tendencia.positiva ? 'tend-up' : 'tend-down'">
        {{ tendencia.positiva ? "▲" : "▼" }} {{ tendencia.valor }}%
        <span class="tend-label">vs periodo anterior</span>
      </div>
      <div v-else class="kpi-tendencia tend-neutral">—</div>
    </template>
  </div>
</template>

<style scoped>
.kpi-card {
  background:    var(--color-surface);
  border:        1px solid var(--color-border);
  border-radius: 12px;
  padding:       20px 24px;
  display:       flex;
  flex-direction: column;
  gap:           8px;
}

.kpi-header   { display: flex; justify-content: space-between; align-items: center; }
.kpi-titulo   { font-size: 13px; color: var(--color-text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
.kpi-icono    { font-size: 20px; opacity: .7; }
.kpi-valor    { font-size: 32px; font-weight: 700; color: var(--color-text); line-height: 1; }

.kpi-tendencia { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.tend-label    { font-weight: 400; color: var(--color-text-muted); }
.tend-up       { color: #22c55e; }
.tend-down     { color: #ef4444; }
.tend-neutral  { color: var(--color-text-muted); }

/* Skeleton */
.kpi-skeleton { display: flex; flex-direction: column; gap: 10px; }
.skel         { border-radius: 6px; background: linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%); background-size: 200%; animation: shimmer 1.4s infinite; }
.skel-titulo  { height: 12px; width: 60%; }
.skel-valor   { height: 36px; width: 80%; }
.skel-tend    { height: 12px; width: 40%; }
@keyframes shimmer { to { background-position: -200% 0; } }
</style>
```

## Grid de KPI cards en el dashboard

```vue
<!-- En DashboardView.vue -->
<script setup lang="ts">
import { ref, onMounted } from "vue";
import KpiCard from "../components/KpiCard.vue";

const cargando = ref(true);
const kpis = ref({
  ventasMes:     { valor: 0, anterior: 0 },
  pedidosMes:    { valor: 0, anterior: 0 },
  ticketMedio:   { valor: 0, anterior: 0 },
  usuariosActivos: { valor: 0, anterior: 0 },
});

onMounted(async () => {
  const r = await fetch("/api/dashboard/kpis");
  const data = await r.json();
  kpis.value  = data;
  cargando.value = false;
});
</script>

<template>
  <div class="kpi-grid">
    <KpiCard titulo="Ventas del mes"     :valor="kpis.ventasMes.valor"       formato="euros"      :anterior="kpis.ventasMes.anterior"       icono="💰" :cargando="cargando" />
    <KpiCard titulo="Pedidos"            :valor="kpis.pedidosMes.valor"      formato="numero"     :anterior="kpis.pedidosMes.anterior"      icono="📦" :cargando="cargando" />
    <KpiCard titulo="Ticket medio"       :valor="kpis.ticketMedio.valor"     formato="euros"      :anterior="kpis.ticketMedio.anterior"     icono="🧾" :cargando="cargando" />
    <KpiCard titulo="Usuarios activos"   :valor="kpis.usuariosActivos.valor" formato="numero"     :anterior="kpis.usuariosActivos.anterior" icono="👥" :cargando="cargando" />
  </div>
</template>

<style scoped>
.kpi-grid {
  display:               grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap:                   16px;
}
</style>
```

## Ruta backend — devolver KPIs y comparativa

```typescript
// routes/dashboard.ts
app.get("/api/dashboard/kpis", { preHandler: requireAuth }, async (req) => {
  const ahora   = new Date();
  const inicioMes      = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const inicioMesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const finMesAnterior    = new Date(ahora.getFullYear(), ahora.getMonth(), 0);

  const [actual, anterior] = await Promise.all([
    obtenerMetricas(inicioMes, ahora),
    obtenerMetricas(inicioMesAnterior, finMesAnterior),
  ]);

  return {
    ventasMes:       { valor: actual.ventas,         anterior: anterior.ventas },
    pedidosMes:      { valor: actual.pedidos,         anterior: anterior.pedidos },
    ticketMedio:     { valor: actual.ticketMedio,     anterior: anterior.ticketMedio },
    usuariosActivos: { valor: actual.usuariosActivos, anterior: anterior.usuariosActivos },
  };
});
```
