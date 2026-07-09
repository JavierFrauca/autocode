# Selector con búsqueda (combobox / autocompletar)

**Categoría:** ui | **Cuándo usar:** elegir UN registro de una lista que puede tener más de ~15-20
opciones (un cliente, un producto, un empleado…) — un `<select>` nativo se vuelve inmanejable a partir de
ahí. Para menos opciones fijas (p.ej. un estado: "activo/inactivo"), usa un `<select>` normal, no esto.

**Ya viene en el andamiaje**: no — créalo la primera vez que un formulario necesite elegir una entidad
de una lista grande (p.ej. el cliente de un pedido) y reutilízalo el resto de veces.

```vue
<!-- components/SelectorBusqueda.vue -->
<script setup lang="ts" generic="T extends { id: string | number }">
import { computed, ref } from "vue";

const props = defineProps<{
  modelValue: T | null;
  opciones: T[];
  /** Cómo mostrar cada opción (texto a buscar y a pintar). */
  etiqueta: (o: T) => string;
  placeholder?: string;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: T | null): void }>();

const abierto = ref(false);
const busqueda = ref("");
const resaltado = ref(0);

const filtradas = computed(() => {
  const q = busqueda.value.trim().toLowerCase();
  const base = q ? props.opciones.filter((o) => props.etiqueta(o).toLowerCase().includes(q)) : props.opciones;
  return base.slice(0, 50); // techo: no pintes miles de filas a la vez
});

function elegir(o: T): void {
  emit("update:modelValue", o);
  busqueda.value = props.etiqueta(o);
  abierto.value = false;
}
function limpiar(): void {
  emit("update:modelValue", null);
  busqueda.value = "";
}
function alTeclear(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") { e.preventDefault(); resaltado.value = Math.min(resaltado.value + 1, filtradas.value.length - 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); resaltado.value = Math.max(resaltado.value - 1, 0); }
  else if (e.key === "Enter") { e.preventDefault(); const o = filtradas.value[resaltado.value]; if (o) elegir(o); }
  else if (e.key === "Escape") { abierto.value = false; }
}
</script>

<template>
  <div class="selector" @focusout="abierto = false">
    <div class="selector-caja">
      <input
        v-model="busqueda"
        class="selector-input"
        :placeholder="placeholder ?? 'Buscar…'"
        @focus="abierto = true"
        @keydown="alTeclear"
      />
      <button v-if="modelValue" class="selector-limpiar" type="button" @click="limpiar" aria-label="Quitar selección">✕</button>
    </div>
    <ul v-if="abierto && filtradas.length" class="selector-lista">
      <li
        v-for="(o, i) in filtradas"
        :key="o.id"
        class="selector-opcion"
        :class="{ activa: i === resaltado }"
        @mousedown.prevent="elegir(o)"
      >
        {{ etiqueta(o) }}
      </li>
    </ul>
    <div v-else-if="abierto" class="selector-vacio">Sin resultados</div>
  </div>
</template>

<style scoped>
.selector { position: relative; }
.selector-caja { display: flex; align-items: center; gap: 6px; }
.selector-input { width: 100%; padding: 8px 10px; border-radius: var(--radius-sm, 8px);
  border: 1px solid var(--border); background: var(--bg, var(--surface)); color: var(--text); }
.selector-limpiar { background: transparent; border: none; color: var(--text-muted); cursor: pointer; }
.selector-lista { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0; margin: 0; padding: 4px;
  list-style: none; max-height: 260px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-sm, 8px); box-shadow: var(--shadow, 0 8px 24px rgba(0,0,0,.15)); }
.selector-opcion { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.selector-opcion.activa, .selector-opcion:hover { background: var(--surface-2); }
.selector-vacio { position: absolute; top: calc(100% + 4px); left: 0; right: 0; padding: 10px; color: var(--text-muted);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); }
</style>
```

## Uso

```vue
<SelectorBusqueda
  v-model="pedido.cliente"
  :opciones="clientes"
  :etiqueta="(c) => `${c.nombre} (${c.nif})`"
  placeholder="Buscar cliente por nombre o NIF…"
/>
```

- **Pocos registros (cientos)**: pasa TODOS los `opciones` ya cargados (el filtrado es en el propio
  componente, como aquí).
- **Muchos (miles+)**: no cargues todo de golpe — pasa solo los resultados de `?q=` del servidor
  (debounce ~300 ms, mismo patrón que `library/ui/busqueda-filtrado.md`) y deja `opciones` como la
  página de resultados actual.

## Reglas

- Navegación por teclado obligatoria (flechas + Enter + Esc) — ya la trae el componente.
- Techo de filas pintadas (aquí 50): una lista de miles de opciones sin paginar/debounce cuelga el navegador.
- Un botón para quitar la selección sin tener que borrar el texto a mano.

Relacionado: `library/ui/busqueda-filtrado.md` (mismo patrón de debounce para listas grandes),
`library/ui/vue-tabla-lista.md`, `library/ui/tema-tokens.md`.
