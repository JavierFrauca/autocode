<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, formatDbDate } from "../api";

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);
const runs = ref<any[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try { runs.value = await api.agentRuns(projectId.value); }
  finally { loading.value = false; }
}

async function cancelRun(id: string) {
  await api.cancelRun(id);
  await load();
}

async function deleteRun(id: string) {
  await api.deleteRun(id);
  await load();
}

const statusColor = (s: string) =>
  s === "applied" ? "ok" : s === "failed" ? "bad" : s === "running" ? "warn" : "info";

onMounted(load);
</script>

<template>
  <div class="content content-tight">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
      <h2 style="margin: 0">Estado interno</h2>
      <span class="badge" style="opacity: 0.6; font-size: 10px">solo para debug</span>
      <span class="spacer" />
      <button class="btn ghost" @click="load" :disabled="loading">↺ actualizar</button>
    </div>

    <div v-if="loading && runs.length === 0" class="muted">Cargando…</div>

    <div v-else-if="runs.length === 0" class="muted" style="text-align: center; padding: 40px">
      Ningún proceso registrado todavía.
    </div>

    <div v-for="r in runs" :key="r.id" class="panel" style="margin-bottom: 8px">
      <div class="panel-header" style="gap: 10px">
        <span class="badge" :class="statusColor(r.status)">{{ r.status }}</span>
        <strong>{{ r.agentType }}</strong>
        <span class="muted mono" style="font-size: 10px">{{ r.id }}</span>
        <span class="spacer" />
        <span class="dim" style="font-size: 11px">{{ formatDbDate(r.createdAt) }}</span>
        <button v-if="r.status === 'pending' || r.status === 'running'"
          class="btn ghost" style="font-size: 11px; padding: 2px 8px"
          @click="cancelRun(r.id)">cancelar</button>
        <button v-if="r.status === 'failed' || r.status === 'cancelled'"
          class="btn ghost" style="font-size: 11px; padding: 2px 8px; color: var(--red)"
          @click="deleteRun(r.id)">quitar</button>
      </div>
      <div v-if="r.errorMessage" class="panel-body">
        <pre class="raw" style="font-size: 10px; color: var(--red)">{{ r.errorMessage }}</pre>
      </div>
    </div>
  </div>
</template>
