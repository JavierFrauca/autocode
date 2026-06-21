<script setup lang="ts">
import { useToastStore } from "../stores/toasts";

// Contenedor de toasts. Va montado UNA vez en App.vue (infraestructura de la cáscara). No lo imprime.
const toasts = useToastStore();
</script>

<template>
  <Teleport to="body">
    <div class="toasts no-print">
      <div
        v-for="t in toasts.toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.tipo}`"
        @click="toasts.quitar(t.id)"
      >
        {{ t.mensaje }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px;
  z-index: 9999; max-width: 360px; }
.toast { padding: 12px 16px; border-radius: var(--radius-sm); background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-left: 4px solid var(--accent); box-shadow: var(--shadow);
  cursor: pointer; font-size: 14px; }
.toast--ok { border-left-color: var(--ok); }
.toast--error { border-left-color: var(--danger); }
.toast--warn { border-left-color: var(--warn); }
.toast--info { border-left-color: var(--accent); }
</style>
