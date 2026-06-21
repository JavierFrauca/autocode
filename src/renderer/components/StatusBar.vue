<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores";

const app = useAppStore();

const services = computed(() => app.health?.services ?? {});
const project = computed(() => {
  const id = app.currentProjectId;
  return id ? app.projects.find((p) => p.id === id)?.name ?? null : null;
});

const llm = computed(() => app.llmActivity?.current ?? app.llmActivity?.last ?? null);
const llmRunning = computed(() => app.llmActivity?.current != null);

const statusText = computed(() => {
  if (!llm.value) return "AutoCode listo";
  if (llmRunning.value) return "pensando…";
  if (llm.value.status === "failed") return "error en la consulta";
  return `listo · ${llm.value.durationMs ?? 0}ms`;
});
</script>

<template>
  <footer class="statusbar">
    <span class="pill" :class="services.db ? 'on' : 'off'" title="Base de datos local">
      <span class="dot" /> datos
    </span>
    <span class="pill" :class="services.provider ? 'on' : 'off'" title="Servidor de IA">
      <span class="dot" /> IA
    </span>
    <span class="pill" :class="services.qdrant ? 'on' : 'off'" title="Motor de búsqueda">
      <span class="dot" /> búsqueda
    </span>

    <span class="llm-status">
      <span class="dot-llm" :class="{ run: llmRunning, fail: llm?.status === 'failed' }" />
      {{ statusText }}
    </span>

    <span class="spacer" />
    <span v-if="project" class="project-name">{{ project }}</span>
  </footer>
</template>

<style scoped>
.llm-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  opacity: 0.85;
}
.dot-llm {
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(0,0,0,0.25);
  flex-shrink: 0;
}
.dot-llm.run { background: #000; animation: pulse 1s infinite; }
.dot-llm.fail { background: #5c0000; }
.project-name { font-size: 11px; opacity: 0.8; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }
</style>
