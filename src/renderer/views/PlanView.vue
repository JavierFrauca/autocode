<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);

const plan = ref<any>(null);
const loading = ref(false);
const generating = ref(false);
const error = ref<string | null>(null);
const appType = ref<"server" | "electron">("server");
const expandedSprints = ref<Set<number>>(new Set([1]));

async function loadPlan() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.getPlan(projectId.value);
    plan.value = r?.planJson ?? null;
  } catch {
    plan.value = null;
  } finally {
    loading.value = false;
  }
}

async function generate() {
  generating.value = true;
  error.value = null;
  try {
    const r = await api.generatePlan(projectId.value, appType.value);
    // Poll for result
    let attempts = 0;
    while (attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const run = await api.agentRun(r.runId);
      if (run.status === "done" || run.status === "applied") {
        await loadPlan();
        break;
      }
      if (run.status === "failed") {
        error.value = run.errorMessage ?? "Error al generar el plan";
        break;
      }
      attempts++;
    }
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    generating.value = false;
  }
}

function toggleSprint(n: number) {
  if (expandedSprints.value.has(n)) expandedSprints.value.delete(n);
  else expandedSprints.value.add(n);
}

onMounted(loadPlan);
watch(projectId, loadPlan);
</script>

<template>
  <div class="content content-tight">
    <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px">
      <div>
        <h2 style="margin: 0 0 4px">Mi Plan de Desarrollo</h2>
        <p class="muted" style="font-size: 12px">
          El plan se genera a partir de tus decisiones y reglas de negocio documentadas.
        </p>
      </div>
      <span class="spacer" />
      <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0">
        <select v-model="appType" style="font-size: 12px">
          <option value="server">Aplicación web (servidor)</option>
          <option value="electron">Aplicación de escritorio</option>
        </select>
        <button class="btn primary" @click="generate" :disabled="generating">
          {{ generating ? "Generando…" : plan ? "Regenerar plan" : "Generar plan" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="badge bad" style="margin-bottom: 16px">{{ error }}</div>

    <div v-if="loading" class="muted" style="text-align: center; padding: 40px">Cargando…</div>

    <div v-else-if="generating" class="panel" style="text-align: center; padding: 40px">
      <p style="font-size: 16px; margin-bottom: 8px">Analizando tu proyecto…</p>
      <p class="muted" style="font-size: 12px">Esto puede tardar 30-60 segundos. El asistente está leyendo toda tu documentación.</p>
    </div>

    <template v-else-if="plan">
      <!-- App info -->
      <div class="panel" style="margin-bottom: 16px">
        <div class="panel-header"><strong>{{ plan.app?.nombre }}</strong></div>
        <div class="panel-body">
          <p class="muted">{{ plan.app?.descripcion }}</p>
          <span class="badge info" style="margin-top: 8px">{{ plan.app?.tipo === "server" ? "Aplicación web" : "Escritorio" }}</span>
        </div>
      </div>

      <!-- Sprints -->
      <div v-for="sprint in plan.sprints" :key="sprint.numero" class="sprint-card">
        <div class="sprint-header" @click="toggleSprint(sprint.numero)">
          <span class="sprint-num">Sprint {{ sprint.numero }}</span>
          <strong class="sprint-title">{{ sprint.titulo }}</strong>
          <span class="dim" style="font-size: 11px; margin-left: 8px">{{ sprint.tareas?.length ?? 0 }} tareas</span>
          <span class="spacer" />
          <span>{{ expandedSprints.has(sprint.numero) ? "▲" : "▼" }}</span>
        </div>

        <div v-if="expandedSprints.has(sprint.numero)" class="sprint-body">
          <p class="muted" style="font-size: 12px; margin-bottom: 14px">{{ sprint.objetivo }}</p>
          <div v-for="tarea in sprint.tareas" :key="tarea.id" class="task-card">
            <div class="task-header">
              <span class="task-id mono">{{ tarea.id }}</span>
              <strong>{{ tarea.titulo }}</strong>
            </div>
            <div class="task-detail">
              <div><span class="label">Recibe:</span> {{ tarea.recibe?.join(", ") }}</div>
              <div><span class="label">Produce:</span> {{ tarea.produce?.join(", ") }}</div>
              <div><span class="label">Verificación:</span> <span class="mono" style="font-size: 11px">{{ tarea.verificacion }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="panel" style="text-align: center; padding: 60px 20px">
      <div style="font-size: 40px; opacity: 0.15; margin-bottom: 16px">◫</div>
      <h3 style="margin: 0 0 8px">Aún no hay plan</h3>
      <p class="muted" style="max-width: 400px; margin: 0 auto 20px">
        Cuando hayas descrito tu negocio suficientemente en el chat, pulsa "Generar plan" y AutoCode creará un plan de desarrollo por etapas.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sprint-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 10px;
  overflow: hidden;
}
.sprint-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-surface);
  cursor: pointer;
  user-select: none;
}
.sprint-header:hover { background: var(--bg-elevated); }
.sprint-num {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--cyan);
  background: color-mix(in srgb, var(--cyan) 12%, transparent);
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}
.sprint-title { font-size: 13px; }
.spacer { flex: 1; }
.sprint-body { padding: 14px 16px; border-top: 1px solid var(--border-dim); }
.task-card {
  background: var(--bg);
  border: 1px solid var(--border-dim);
  border-radius: 4px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.task-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.task-id { font-size: 10px; color: var(--text-dim); }
.task-detail { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
.label { color: var(--text-dim); font-weight: 600; margin-right: 4px; }
</style>
