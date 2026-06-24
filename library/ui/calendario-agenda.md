# Vista de calendario / agenda (sin librerías)

**Categoría:** ui | **Cuándo usar:** apps de citas, reservas, turnos, planning, vencimientos… cualquier cosa
con fechas que se entiende mejor en una rejilla mensual o una agenda. Componente Vue **en CSS grid puro, cero
librerías** (ni FullCalendar ni date-fns), al estilo de los dashboards de `library/ui/dashboards.md`.

**Idea:** el componente recibe una lista de eventos `{ id, titulo, inicio, fin?, color? }` y pinta el mes;
emite `dia-click` (para crear) y `evento-click` (para abrir). Los datos salen de tu API; el componente NO
sabe de negocio. Semana **empieza en lunes** (convención ES).

## Componente de mes (`web/src/components/CalendarioMes.vue`)

```vue
<script setup lang="ts">
import { ref, computed } from "vue";

export interface EventoCal { id: string; titulo: string; inicio: string; fin?: string; color?: string; }

const props = withDefaults(defineProps<{ eventos?: EventoCal[]; mesInicial?: Date }>(),
  { eventos: () => [], mesInicial: () => new Date() });
const emit = defineEmits<{ (e: "dia-click", iso: string): void; (e: "evento-click", id: string): void }>();

const cursor = ref(new Date(props.mesInicial.getFullYear(), props.mesInicial.getMonth(), 1));
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function iso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// Celdas: relleno desde el lunes anterior hasta completar semanas de 7.
const celdas = computed(() => {
  const y = cursor.value.getFullYear(), m = cursor.value.getMonth();
  const primero = new Date(y, m, 1);
  const offset = (primero.getDay() + 6) % 7;             // 0 = lunes
  const inicio = new Date(y, m, 1 - offset);
  const total = Math.ceil((offset + new Date(y, m + 1, 0).getDate()) / 7) * 7;
  const hoy = iso(new Date());
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    const clave = iso(d);
    return {
      clave, dia: d.getDate(), otroMes: d.getMonth() !== m, esHoy: clave === hoy,
      eventos: props.eventos.filter((e) => e.inicio.slice(0, 10) === clave),
    };
  });
});

const titulo = computed(() => `${MESES[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`);
function mover(n: number) { cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + n, 1); }
function hoy() { const d = new Date(); cursor.value = new Date(d.getFullYear(), d.getMonth(), 1); }
</script>

<template>
  <div class="cal">
    <header class="cal-cab">
      <button class="btn btn-secundario" @click="mover(-1)">‹</button>
      <strong class="cal-titulo">{{ titulo }}</strong>
      <button class="btn btn-secundario" @click="mover(1)">›</button>
      <button class="btn" @click="hoy()">Hoy</button>
    </header>

    <div class="cal-dias">
      <span v-for="d in DIAS" :key="d">{{ d }}</span>
    </div>

    <div class="cal-rejilla">
      <button v-for="c in celdas" :key="c.clave" class="cal-celda"
              :class="{ 'otro-mes': c.otroMes, hoy: c.esHoy }" @click="emit('dia-click', c.clave)">
        <span class="cal-num">{{ c.dia }}</span>
        <span v-for="e in c.eventos.slice(0, 3)" :key="e.id" class="cal-ev"
              :style="{ background: e.color ?? 'var(--accent)' }"
              :title="e.titulo" @click.stop="emit('evento-click', e.id)">{{ e.titulo }}</span>
        <span v-if="c.eventos.length > 3" class="cal-mas">+{{ c.eventos.length - 3 }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cal-cab { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cal-titulo { flex: 1; text-transform: capitalize; font-size: 16px; }
.cal-dias, .cal-rejilla { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-dias { margin-bottom: 4px; font-size: 12px; color: var(--text-muted); text-align: center; }
.cal-celda {
  min-height: 92px; display: flex; flex-direction: column; gap: 2px; padding: 4px 5px;
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--r-sm);
  text-align: left; cursor: pointer; overflow: hidden;
}
.cal-celda:hover { border-color: var(--accent); }
.cal-celda.otro-mes { opacity: .45; }
.cal-celda.hoy { outline: 2px solid var(--accent); }
.cal-num { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.cal-celda.hoy .cal-num { color: var(--accent); }
.cal-ev {
  font-size: 11px; color: #fff; padding: 1px 5px; border-radius: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cal-mas { font-size: 10px; color: var(--text-muted); }
</style>
```

Uso:

```vue
<CalendarioMes :eventos="eventos" @dia-click="crearEn" @evento-click="abrir" />
```

- `eventos` = lo que devuelve tu API (`[{ id, titulo, inicio: "2026-07-01T10:00:00", color }]`). El componente
  agrupa por día comparando `inicio.slice(0,10)`.
- `@dia-click` → abre el formulario de "nueva cita" con esa fecha; `@evento-click` → abre la ficha.

## Vista de AGENDA (lista) — alternativa para móvil o pocos eventos

Una lista simple agrupada por día (mismo dato, sin rejilla): ordena por `inicio`, agrupa por `inicio.slice(0,10)`
y pinta `hora — título`. Útil como segunda pestaña ("Mes" / "Agenda") o en pantallas estrechas.

## Datos en el backend

Guarda los eventos como una entidad normal (repo + tabla) con `inicio`/`fin` en ISO. Filtra por rango de mes
en la API para no traer todo:

```ts
app.get("/api/citas", async (req) => {
  const { desde, hasta } = req.query as { desde: string; hasta: string }; // el front manda el mes visible
  return repos.citas.entreFechas(desde, hasta);
});
```

## Reglas

- Cero librerías de calendario/fechas: la aritmética de meses con `Date` nativo basta (ojo: usa el constructor
  `new Date(y, m, d)`, que normaliza desbordes de mes solo).
- Semana en **lunes** (`(getDay()+6)%7`) para España.
- Colorea por estado/tipo con los tokens del tema (`library/ui/tema-tokens.md`), no con colores sueltos.
- Pide al backend solo el rango visible; no traigas todos los eventos de la historia.
- Para huso horario: guarda en ISO y compara por `slice(0,10)` (día local) salvo que necesites UTC estricto.

Relacionado: tema `library/ui/tema-tokens.md`, tablas/listas `library/ui/vue-tabla-lista.md`,
formato de fechas `library/ui/formato-i18n.md`, notificaciones de vencimiento `library/integraciones/notificaciones-inapp.md`.
