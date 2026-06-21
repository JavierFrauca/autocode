<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { ChevronDown } from "lucide-vue-next";

/**
 * Botón de acción dividido (split-button): la parte principal ejecuta la acción por defecto; la flecha
 * abre un menú flotante con acciones alternativas (no es un <select> nativo). Click fuera / Esc cierran.
 */
export interface SplitItem {
  key: string;
  label: string;
  description?: string;
  danger?: boolean;
}

defineProps<{
  label: string;
  items: SplitItem[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: "primary"): void; (e: "select", key: string): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
function toggle() {
  open.value = !open.value;
  if (open.value) {
    window.addEventListener("click", onDocClick, true);
    window.addEventListener("keydown", onKey);
  }
}
function close() {
  open.value = false;
  window.removeEventListener("click", onDocClick, true);
  window.removeEventListener("keydown", onKey);
}
function choose(key: string) {
  close();
  emit("select", key);
}
onBeforeUnmount(close);
</script>

<template>
  <div class="split" ref="root" :class="{ disabled }">
    <button class="split-main" :disabled="disabled" @click="emit('primary')">
      <slot name="icon" />
      <span>{{ label }}</span>
    </button>
    <button
      class="split-caret"
      :disabled="disabled"
      :aria-expanded="open"
      title="Más opciones"
      @click.stop="toggle"
    >
      <ChevronDown :size="15" :stroke-width="2.4" :class="{ rot: open }" />
    </button>

    <transition name="split-pop">
      <div v-if="open" class="split-menu" role="menu">
        <button
          v-for="it in items"
          :key="it.key"
          class="split-item"
          :class="{ danger: it.danger }"
          role="menuitem"
          @click="choose(it.key)"
        >
          <span class="split-item-label">{{ it.label }}</span>
          <span v-if="it.description" class="split-item-desc">{{ it.description }}</span>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.split {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--r);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.split.disabled { opacity: 0.65; }

.split-main,
.split-caret {
  background: var(--accent);
  color: #fff;
  border: none;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.split-main {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: var(--r) 0 0 var(--r);
}
.split-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 0 var(--r) var(--r) 0;
  border-left: 1px solid color-mix(in srgb, #000 18%, var(--accent));
}
.split-main:hover:not(:disabled),
.split-caret:hover:not(:disabled) { background: var(--accent-dark); }
.split-main:disabled,
.split-caret:disabled { cursor: default; }
.split-caret .rot { transform: rotate(180deg); transition: transform 0.15s; }

/* ── Menú flotante ── */
.split-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 230px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow, 0 12px 32px rgba(0, 0, 0, 0.28));
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.split-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--r);
  padding: 8px 10px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s;
}
.split-item:hover { background: var(--bg-hover); }
.split-item-label { font-size: 13px; font-weight: 600; color: var(--text); }
.split-item-desc { font-size: 11.5px; color: var(--text-muted); line-height: 1.35; }
.split-item.danger:hover { background: color-mix(in srgb, var(--red) 12%, transparent); }
.split-item.danger .split-item-label { color: var(--red); }

.split-pop-enter-active,
.split-pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.split-pop-enter-from,
.split-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
