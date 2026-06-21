# Plantilla: Dashboard (panel de control) — web y escritorio

**tags:** ui, dashboard, panel, kpi, grafico, chart, donut, barras, vue, web, escritorio, metricas
**transversal:** true
**Cuándo usar:** cuando la app tiene **entidad/alcance suficiente** y está justificado mostrar un panel de
control con métricas (ver `library/ui/dashboards.md` para el criterio). Componentes Vue con **SVG + CSS
puro, SIN librerías de charting** (encajan en Electron y en web; respetan el tema con variables CSS y
fallback). Crea estos ficheros en `src/renderer/src/components` (escritorio) o `src/components` (web).

## `KpiCard.vue` — tarjeta de métrica
```vue
<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  icon?: string;
  delta?: { pct: string; dir: "up" | "down"; vs?: string };
}>();
</script>
<template>
  <div class="kpi">
    <div class="kpi-top">
      <span class="kpi-label">{{ label }}</span>
      <span v-if="icon" class="kpi-ico">{{ icon }}</span>
    </div>
    <div class="kpi-val">{{ value }}</div>
    <span v-if="delta" class="delta" :class="delta.dir">
      {{ delta.dir === "up" ? "▲" : "▼" }} {{ delta.pct }}
      <span v-if="delta.vs" class="vs">{{ delta.vs }}</span>
    </span>
  </div>
</template>
<style scoped>
.kpi{background:var(--bg-surface,#fff);border:1px solid var(--border,#e7ecf3);border-radius:14px;padding:18px;box-shadow:var(--shadow-sm,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.05))}
.kpi-top{display:flex;align-items:center;justify-content:space-between}
.kpi-label{font-size:12.5px;color:var(--text-muted,#64748b);font-weight:600}
.kpi-ico{width:34px;height:34px;border-radius:9px;background:var(--accent-soft,#eef0fe);color:var(--accent,#4f46e5);display:flex;align-items:center;justify-content:center;font-size:17px}
.kpi-val{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:12px 0 6px;color:var(--text,#0f172a)}
.delta{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px}
.delta.up{color:var(--green,#16a34a);background:color-mix(in srgb,var(--green,#16a34a) 12%,transparent)}
.delta.down{color:var(--red,#dc2626);background:color-mix(in srgb,var(--red,#dc2626) 12%,transparent)}
.delta .vs{color:var(--dim,#94a3b8);font-weight:500;margin-left:4px}
</style>
```

## `BarChart.vue` — gráfico de barras (SVG/CSS, sin deps)
```vue
<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ items: { label: string; value: number }[]; height?: number; mutedFrom?: number }>();
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
</script>
<template>
  <div class="bars" :style="{ height: (height ?? 190) + 'px' }">
    <div v-for="(it, i) in items" :key="i" class="bar-col">
      <div class="bar" :class="{ muted: mutedFrom != null && i >= mutedFrom }"
           :style="{ height: (it.value / max * 100) + '%' }" :title="`${it.label}: ${it.value}`"></div>
      <span class="bar-x">{{ it.label }}</span>
    </div>
  </div>
</template>
<style scoped>
.bars{display:flex;align-items:flex-end;gap:14px;padding-top:8px}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%}
.bar{width:100%;max-width:30px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#6366f1,var(--accent,#4f46e5));align-self:flex-end;transition:height .3s ease}
.bar.muted{background:linear-gradient(180deg,#c7cbf5,#aeb4ee)}
.bar-x{font-size:11px;color:var(--dim,#94a3b8);font-weight:600}
</style>
```

## `DonutChart.vue` — distribución (SVG, geometría calculada)
```vue
<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ segments: { label: string; value: number; color: string }[] }>();
const total = computed(() => props.segments.reduce((s, x) => s + x.value, 0) || 1);
// Circunferencia = 100 con r=15.9155 → los porcentajes son directos. linecap "butt" para que no solapen.
const arcs = computed(() => {
  let acc = 0;
  return props.segments.map((s) => {
    const pct = (s.value / total.value) * 100;
    const arc = { color: s.color, dash: `${pct} ${100 - pct}`, offset: 25 - acc };
    acc += pct;
    return arc;
  });
});
const pct = (v: number) => Math.round((v / total.value) * 100);
</script>
<template>
  <div class="donut-wrap">
    <svg width="130" height="130" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--border,#eef1f6)" stroke-width="6" />
      <circle v-for="(a, i) in arcs" :key="i" cx="21" cy="21" r="15.9155" fill="none"
              :stroke="a.color" stroke-width="6" :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" stroke-linecap="butt" />
      <text x="21" y="20.5" text-anchor="middle" font-size="6.5" font-weight="800" fill="var(--text,#0f172a)">100%</text>
      <text x="21" y="26" text-anchor="middle" font-size="3.2" fill="var(--dim,#94a3b8)">total</text>
    </svg>
    <div class="legend">
      <div v-for="(s, i) in segments" :key="i" class="leg">
        <span class="dot" :style="{ background: s.color }"></span>{{ s.label }}<span class="v">{{ pct(s.value) }}%</span>
      </div>
    </div>
  </div>
</template>
<style scoped>
.donut-wrap{display:flex;align-items:center;gap:18px}
.legend{display:flex;flex-direction:column;gap:10px;flex:1}
.leg{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text,#0f172a)}
.dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.leg .v{margin-left:auto;font-weight:700}
</style>
```

## `DashboardView.vue` — compone todo (adapta los datos a tu dominio)
```vue
<script setup lang="ts">
import KpiCard from "./KpiCard.vue";
import BarChart from "./BarChart.vue";
import DonutChart from "./DonutChart.vue";

// Sustituye estos datos de ejemplo por los reales (de tu store / IPC / API).
const meses = [
  { label: "Ene", value: 42 }, { label: "Feb", value: 55 }, { label: "Mar", value: 48 },
  { label: "Abr", value: 67 }, { label: "May", value: 60 }, { label: "Jun", value: 78 },
  { label: "Jul", value: 72 }, { label: "Ago", value: 85 }, { label: "Sep", value: 74 },
  { label: "Oct", value: 92 }, { label: "Nov", value: 81 }, { label: "Dic", value: 58 },
];
const distribucion = [
  { label: "Suscripciones", value: 46, color: "#4f46e5" },
  { label: "Servicios", value: 30, color: "#22c55e" },
  { label: "Productos", value: 24, color: "#f59e0b" },
];
</script>
<template>
  <div class="dash">
    <header class="dash-head">
      <div><h1>Panel de control</h1><p>Resumen de actividad</p></div>
    </header>
    <section class="kpis">
      <KpiCard label="Ingresos" value="128.430 €" icon="€" :delta="{ pct: '12,4%', dir: 'up', vs: 'vs mes ant.' }" />
      <KpiCard label="Pedidos" value="1.984" icon="🧾" :delta="{ pct: '8,1%', dir: 'up', vs: 'vs mes ant.' }" />
      <KpiCard label="Clientes" value="742" icon="👥" :delta="{ pct: '2,3%', dir: 'down', vs: 'vs mes ant.' }" />
      <KpiCard label="Ticket medio" value="64,73 €" icon="📈" :delta="{ pct: '3,9%', dir: 'up', vs: 'vs mes ant.' }" />
    </section>
    <section class="row">
      <div class="panel">
        <div class="panel-head"><h2>Ingresos por mes</h2><span class="sub">Año actual</span></div>
        <BarChart :items="meses" :muted-from="10" />
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Distribución</h2><span class="sub">Por categoría</span></div>
        <DonutChart :segments="distribucion" />
      </div>
    </section>
  </div>
</template>
<style scoped>
.dash{padding:8px 4px}
.dash-head h1{font-size:22px;font-weight:800;letter-spacing:-.02em;color:var(--text,#0f172a)}
.dash-head p{color:var(--text-muted,#64748b);font-size:13.5px;margin-top:3px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:20px 0 18px}
.row{display:grid;grid-template-columns:1.85fr 1fr;gap:16px}
.panel{background:var(--bg-surface,#fff);border:1px solid var(--border,#e7ecf3);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow-sm,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.05))}
.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.panel-head h2{font-size:14.5px;font-weight:700;color:var(--text,#0f172a)}
.panel-head .sub{font-size:12px;color:var(--text-muted,#64748b)}
@media (max-width:880px){.kpis{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}
</style>
```

## Reglas
- **Sin librerías de charting** (no chart.js, no d3): barras con CSS, donut/líneas con SVG. Mantiene el bundle ligero y sin dependencias nativas.
- Los datos son **props**: el dashboard NO calcula negocio; recibe los agregados ya hechos (de un servicio/store/IPC).
- Respeta el tema: usa `--accent`, `--green`, `--red`, `--bg-surface`, `--text`, `--border`… (con fallback claro).
- Para tablas de "últimos N", reutiliza el patrón de tabla de `templates/web/vue-crud-view.md`.
- Cuántos dashboards y qué métricas: ver `library/ui/dashboards.md`.
