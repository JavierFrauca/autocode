# Charts en Vue 3 con ECharts

**Categoría:** ui | **Cuándo usar:** Gráficos de líneas, barras, dona y área para dashboards. ECharts es la elección del stack: tree-shakeable, declarativo, sin conflictos con Vue 3 reactivity.

## Instalación

```
npm install echarts vue-echarts
```

## Registro global (main.ts)

```typescript
import { createApp } from "vue";
import ECharts from "vue-echarts";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent,
  TitleComponent, DataZoomComponent,
} from "echarts/components";

use([CanvasRenderer, LineChart, BarChart, PieChart,
     GridComponent, TooltipComponent, LegendComponent,
     TitleComponent, DataZoomComponent]);

const app = createApp(App);
app.component("VChart", ECharts);
```

## Gráfico de líneas — serie temporal

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { EChartsOption } from "echarts";

const props = defineProps<{
  datos: { fecha: string; valor: number }[];
  titulo?: string;
  color?: string;
}>();

const opcion = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis", formatter: (p: any) => `${p[0].name}: ${p[0].value}` },
  grid:    { left: 40, right: 20, top: 40, bottom: 30 },
  xAxis: {
    type:        "category",
    data:        props.datos.map((d) => d.fecha),
    axisLabel:   { rotate: 30, fontSize: 11 },
  },
  yAxis: { type: "value", splitLine: { lineStyle: { type: "dashed" } } },
  series: [{
    type:      "line",
    data:      props.datos.map((d) => d.valor),
    smooth:    true,
    areaStyle: { opacity: 0.08 },
    lineStyle: { color: props.color ?? "#4472C4", width: 2 },
    itemStyle: { color: props.color ?? "#4472C4" },
  }],
}));
</script>

<template>
  <v-chart :option="opcion" autoresize style="height: 300px" />
</template>
```

## Gráfico de barras — comparativa por categoría

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { EChartsOption } from "echarts";

const props = defineProps<{
  categorias: string[];
  series: { nombre: string; datos: number[]; color?: string }[];
}>();

const opcion = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  legend:  { bottom: 0 },
  grid:    { left: 50, right: 20, top: 20, bottom: 40 },
  xAxis:   { type: "category", data: props.categorias },
  yAxis:   { type: "value" },
  series:  props.series.map((s) => ({
    name:      s.nombre,
    type:      "bar",
    data:      s.datos,
    itemStyle: { color: s.color },
    barMaxWidth: 48,
  })),
}));
</script>

<template>
  <v-chart :option="opcion" autoresize style="height: 300px" />
</template>
```

## Gráfico de dona — distribución porcentual

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { EChartsOption } from "echarts";

const props = defineProps<{
  datos: { nombre: string; valor: number }[];
  titulo?: string;
}>();

const opcion = computed<EChartsOption>(() => ({
  tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
  legend:  { orient: "vertical", right: 10, top: "center" },
  series: [{
    type:      "pie",
    radius:    ["45%", "70%"],
    center:    ["40%", "50%"],
    data:      props.datos.map((d) => ({ name: d.nombre, value: d.valor })),
    label:     { show: false },
    emphasis:  { label: { show: true, fontWeight: "bold" } },
  }],
}));
</script>

<template>
  <div>
    <p v-if="props.titulo" class="chart-title">{{ props.titulo }}</p>
    <v-chart :option="opcion" autoresize style="height: 260px" />
  </div>
</template>
```

## Actualización reactiva — sin recrear el chart

```vue
<script setup lang="ts">
import { ref, watch } from "vue";

// ✅ Mutar la opción existente — ECharts hace diff interno
const opcion = ref<EChartsOption>({ series: [{ type: "line", data: [] }] });

async function cargarDatos(desde: string, hasta: string) {
  const r = await fetch(`/api/metricas?desde=${desde}&hasta=${hasta}`);
  const datos = await r.json();
  // Asignar directamente — vue-echarts detecta el cambio y aplica setOption internamente
  opcion.value = {
    ...opcion.value,
    series: [{ ...opcion.value.series![0] as any, data: datos.map((d: any) => d.valor) }],
  };
}

watch([() => props.desde, () => props.hasta], ([d, h]) => cargarDatos(d, h), { immediate: true });
</script>

<template>
  <v-chart :option="opcion" :update-options="{ notMerge: false }" autoresize style="height: 300px" />
</template>
```

## Estado de carga

```vue
<template>
  <div class="chart-wrapper">
    <div v-if="cargando" class="chart-skeleton" />
    <v-chart v-else :option="opcion" autoresize style="height: 300px" />
  </div>
</template>

<style scoped>
.chart-skeleton {
  height: 300px;
  background: linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 8px;
}
@keyframes shimmer { to { background-position: -200% 0; } }
</style>
```

## Notas

- **`autoresize`**: prop de `vue-echarts` que conecta un `ResizeObserver` automáticamente — no hace falta hacerlo a mano.
- **Tree-shaking**: solo importa los tipos de chart que uses en `use([...])` — el bundle final solo incluye lo registrado.
- **Temas**: ECharts acepta temas custom (`echarts.registerTheme("mi-tema", {...})`) para que los charts encajen con el diseño de la app.
