# Modal / diálogo genérico (contenido a medida)

**Categoría:** ui | **Cuándo usar:** cuando hay que mostrar contenido a medida encima de la pantalla —
un formulario de edición, una ficha de detalle, una tabla de registros relacionados, un asistente de
varios pasos… Para avisar, confirmar o pedir un dato SUELTO (una frase + botones) usa en su lugar
`templates/web/dialogs.md` (`dialogs.alert/confirm/prompt`): no reimplementes eso con este componente.

**Ya viene en el andamiaje**: ninguno de los dos trae este componente aún — créalo la primera vez que una
pantalla necesite un modal de contenido (crear/editar en una capa encima de la lista, por ejemplo) y
reutilízalo el resto de veces.

```vue
<!-- components/Modal.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  titulo?: string;
  ancho?: "sm" | "md" | "lg";
}>(), { ancho: "md" });

const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

function cerrar(): void {
  emit("update:modelValue", false);
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.modelValue) cerrar();
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));

// Bloquea el scroll del fondo mientras el modal está abierto.
watch(() => props.modelValue, (abierto) => {
  document.body.style.overflow = abierto ? "hidden" : "";
}, { immediate: true });
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-overlay" @mousedown.self="cerrar" role="dialog" aria-modal="true">
      <div class="modal-card" :class="`modal-card--${ancho}`">
        <header class="modal-head">
          <h2 class="modal-titulo"><slot name="titulo">{{ titulo }}</slot></h2>
          <button class="modal-cerrar" type="button" aria-label="Cerrar" @click="cerrar">✕</button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.acciones" class="modal-acciones"><slot name="acciones" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center;
  justify-content: center; background: rgba(15, 23, 42, .55); padding: var(--space, 8px); }
.modal-card { width: 100%; background: var(--surface); color: var(--text); border-radius: var(--radius, 12px);
  box-shadow: var(--shadow, 0 24px 64px rgba(0,0,0,.35)); display: flex; flex-direction: column; max-height: 90vh; }
.modal-card--sm { max-width: 420px; } .modal-card--md { max-width: 640px; } .modal-card--lg { max-width: 960px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px;
  border-bottom: 1px solid var(--border); }
.modal-titulo { font-size: 1.05rem; margin: 0; }
.modal-cerrar { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; }
.modal-cerrar:hover { color: var(--text); }
.modal-body { padding: 20px; overflow-y: auto; }
.modal-acciones { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px;
  border-top: 1px solid var(--border); }
</style>
```

## Uso

```vue
<Modal v-model="editando" titulo="Editar cliente" ancho="md">
  <FormularioCliente v-model="cliente" />
  <template #acciones>
    <button @click="editando = false">Cancelar</button>
    <button class="primary" @click="guardar">Guardar</button>
  </template>
</Modal>
```

## Reglas

- Un modal a la vez (no anides modales; si hace falta un paso intermedio, usa un asistente de pasos DENTRO
  del mismo modal, no uno encima de otro).
- `Esc` y click en el fondo cierran (salvo que la acción sea destructiva/larga — en ese caso solo el
  botón explícito de cerrar).
- El contenido va SIEMPRE en el slot por defecto; no metas alert/confirm de una frase aquí (usa `dialogs.*`).
- Bloquea el scroll de fondo mientras está abierto (ya lo hace el componente).
- Accesibilidad mínima: `role="dialog"` + `aria-modal="true"` (ya incluidos); el foco debería moverse al
  primer campo del formulario interno.

Relacionado: `templates/web/dialogs.md` (alert/confirm/prompt), `library/ui/tema-tokens.md` (colores).
