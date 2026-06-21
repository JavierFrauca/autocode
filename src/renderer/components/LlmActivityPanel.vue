<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Activity, X, Loader, Clock, CheckCircle2, XCircle, Ban, Trash2 } from "lucide-vue-next";
import { api, timeAgo } from "../api";
import { useAppStore } from "../stores";

const app = useAppStore();
const open = computed(() => app.llmPanelOpen);

const runs = ref<any[]>([]);
const otherCalls = ref<any[]>([]);
const activeCount = ref(0);
const current = ref<any>(null);
const loading = ref(false);
let timer: any = null;

const SOURCE_LABEL: Record<string, string> = {
  chat: "Conversación",
  embeddings: "Búsqueda (embeddings)",
  "session-title": "Título de conversación",
  "knowledge-search": "Búsqueda semántica",
  "knowledge-kb-search": "Búsqueda en biblioteca",
  "attach-summary": "Resumen de adjunto",
  "library-index": "Indexado de biblioteca",
  verify: "Comprobación de conexión",
};
const srcLabel = (s: string) => SOURCE_LABEL[s] ?? s;

const AGENT_LABEL: Record<string, string> = {
  documenter: "Documentando",
  planner: "Planificando",
  coder: "Generando código",
  qa: "Verificando calidad",
  executor: "Construyendo la app",
  reindexer: "Indexando búsqueda",
  reconciler: "Ajustando documentación",
  packager: "Preparando el instalador",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "En cola", cls: "pending" },
  running: { label: "En proceso", cls: "running" },
  done: { label: "Hecho", cls: "done" },
  applied: { label: "Hecho", cls: "done" },
  discarded: { label: "Descartado", cls: "muted" },
  failed: { label: "Falló", cls: "failed" },
  cancelled: { label: "Cancelado", cls: "cancelled" },
};
const isActive = (s: string) => s === "pending" || s === "running";

async function load() {
  loading.value = true;
  try {
    const r = await api.llmQueue();
    runs.value = r.runs ?? [];
    otherCalls.value = (r as any).otherCalls ?? [];
    activeCount.value = r.activeCount ?? 0;
    current.value = r.current ?? null;
  } catch { /* el panel no debe romper si la API falla */ }
  finally { loading.value = false; }
}

async function cancelOne(id: string) {
  try { await api.cancelLlm(id); await load(); } catch {}
}
async function cancelAll() {
  try { await api.cancelAllLlm(); await load(); } catch {}
}
async function removeOne(id: string) {
  try { await api.deleteRun(id); await load(); } catch {}
}
async function clearHistory() {
  try { await api.clearLlmHistory(); await load(); } catch {}
}

const hasFinished = computed(() => runs.value.some((r) => !isActive(r.status)));

watch(open, (v) => {
  clearInterval(timer);
  if (v) { load(); timer = setInterval(load, 1600); }
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="llm-backdrop" @click="app.llmPanelOpen = false" />
    <aside class="llm-panel" :class="{ open }">
      <div class="llm-head">
        <Activity :size="18" :stroke-width="2" />
        <strong>Actividad de la IA</strong>
        <span v-if="activeCount" class="llm-active-badge">{{ activeCount }} en marcha</span>
        <button class="llm-icon" title="Cerrar" @click="app.llmPanelOpen = false"><X :size="17" /></button>
      </div>

      <div class="llm-actions">
        <button class="llm-cancel-all" :disabled="!activeCount" @click="cancelAll">
          <Ban :size="14" :stroke-width="2" /> Cancelar la cola
        </button>
        <button class="llm-cancel-all" :disabled="!hasFinished" @click="clearHistory">
          <Trash2 :size="14" :stroke-width="2" /> Limpiar historial
        </button>
      </div>

      <!-- Petición en curso: modelo + desplegable con lo que ENTRA al modelo, en vivo (se refresca con el sondeo). -->
      <div v-if="current" class="llm-current-box">
        <div class="llm-current-line">
          <Loader :size="13" :stroke-width="2" class="spin" />
          <span>Ahora: <strong>{{ current.model }}</strong> · {{ srcLabel(current.source) }}</span>
        </div>
        <details v-if="current.input && current.input.length" class="llm-input">
          <summary>Ver lo que entra · {{ current.input.length }} mensaje(s)</summary>
          <div class="llm-input-body">
            <div v-for="(m, idx) in current.input" :key="idx" class="llm-msg">
              <span class="llm-msg-role">{{ m.role }}</span>
              <pre class="llm-msg-text">{{ m.content }}</pre>
            </div>
          </div>
        </details>
        <div v-else class="llm-input-none">Esta llamada no expone su entrada (p. ej. embeddings).</div>
      </div>

      <div class="llm-list">
        <div v-for="r in runs" :key="r.id" class="llm-row" :class="STATUS[r.status]?.cls">
          <span class="llm-ico">
            <Loader v-if="r.status === 'running'" :size="16" :stroke-width="2" class="spin" />
            <Clock v-else-if="r.status === 'pending'" :size="16" :stroke-width="2" />
            <CheckCircle2 v-else-if="r.status === 'done' || r.status === 'applied'" :size="16" :stroke-width="2" />
            <Ban v-else-if="r.status === 'cancelled'" :size="16" :stroke-width="2" />
            <XCircle v-else-if="r.status === 'failed'" :size="16" :stroke-width="2" />
            <Trash2 v-else :size="16" :stroke-width="2" />
          </span>
          <div class="llm-body">
            <div class="llm-line1">
              <span class="llm-source">{{ AGENT_LABEL[r.agentType] ?? r.agentType }}</span>
              <span class="llm-status">{{ STATUS[r.status]?.label ?? r.status }}</span>
            </div>
            <div class="llm-line2">
              <span v-if="r.modelName" class="llm-model">{{ r.modelName }}</span>
              <span v-if="r.modelRole" class="llm-role">· {{ r.modelRole }}</span>
              <span class="llm-proj">· {{ r.projectName ?? "—" }}</span>
              <span class="llm-time">· {{ timeAgo(r.createdAt) }}</span>
            </div>
            <div v-if="r.status === 'failed' && r.errorMessage" class="llm-err">{{ r.errorMessage }}</div>
          </div>
          <button v-if="isActive(r.status)" class="llm-row-cancel" title="Cancelar" @click="cancelOne(r.id)">
            <X :size="15" :stroke-width="2.5" />
          </button>
          <button v-else class="llm-row-cancel" title="Quitar" @click="removeOne(r.id)">
            <X :size="15" :stroke-width="2.5" />
          </button>
        </div>

        <template v-if="otherCalls.length">
          <div class="llm-subhead">Otras llamadas (conversación, búsqueda…)</div>
          <div v-for="c in otherCalls" :key="c.id" class="llm-row" :class="STATUS[c.status]?.cls">
            <span class="llm-ico">
              <Loader v-if="c.status === 'running'" :size="16" :stroke-width="2" class="spin" />
              <CheckCircle2 v-else-if="c.status === 'done'" :size="16" :stroke-width="2" />
              <XCircle v-else :size="16" :stroke-width="2" />
            </span>
            <div class="llm-body">
              <div class="llm-line1">
                <span class="llm-source">{{ srcLabel(c.source) }}</span>
                <span class="llm-status">{{ STATUS[c.status]?.label ?? c.status }}</span>
              </div>
              <div class="llm-line2">
                <span v-if="c.model" class="llm-model">{{ c.model }}</span>
                <span class="llm-time">· {{ timeAgo(c.startedAt) }}</span>
              </div>
              <div v-if="c.status === 'failed' && c.error" class="llm-err">{{ c.error }}</div>
            </div>
            <button
              v-if="c.status === 'running' && c.cancellable"
              class="llm-row-cancel" title="Cancelar" @click="cancelOne(c.id)"
            >
              <X :size="15" :stroke-width="2.5" />
            </button>
          </div>
        </template>

        <div v-if="runs.length === 0 && otherCalls.length === 0 && !loading" class="llm-empty">
          No hay peticiones registradas todavía.
        </div>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.llm-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.28); z-index: 998; }
.llm-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 92vw;
  background: var(--bg-surface); border-left: 1px solid var(--border);
  box-shadow: -8px 0 30px rgba(0,0,0,.18); z-index: 999;
  display: flex; flex-direction: column; transform: translateX(100%);
  transition: transform .22s ease;
}
.llm-panel.open { transform: translateX(0); }

.llm-head {
  display: flex; align-items: center; gap: 9px;
  padding: 14px 16px; border-bottom: 1px solid var(--border); color: var(--text);
}
.llm-head strong { font-size: 15px; }
.llm-active-badge {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
}
.llm-icon {
  margin-left: auto; background: transparent; border: none; cursor: pointer;
  color: var(--text-muted); display: flex; padding: 4px; border-radius: var(--r-sm);
}
.llm-icon:hover { background: var(--bg-hover); color: var(--text); }

.llm-actions {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--border-dim);
}
.llm-cancel-all {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid var(--border); border-radius: var(--r);
  padding: 6px 12px; font-size: 12.5px; font-weight: 600; color: var(--text-muted);
  cursor: pointer; font-family: inherit;
}
.llm-cancel-all:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
.llm-cancel-all:disabled { opacity: .45; cursor: default; }
.llm-current { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--accent); }

/* ── Petición en curso + "ver lo que entra" ── */
.llm-current-box {
  padding: 10px 16px; border-bottom: 1px solid var(--border-dim);
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
.llm-current-line { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--accent); }
.llm-current-line strong { font-family: var(--font-mono); font-weight: 700; }
.llm-input { margin-top: 8px; }
.llm-input > summary {
  cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-muted);
  list-style: revert; user-select: none; padding: 2px 0;
}
.llm-input > summary:hover { color: var(--text); }
.llm-input-body {
  margin-top: 8px; max-height: 320px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--border); border-radius: var(--r); padding: 8px; background: var(--bg);
}
.llm-msg { display: flex; flex-direction: column; gap: 3px; }
.llm-msg-role {
  align-self: flex-start; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
  padding: 1px 7px; border-radius: 999px;
}
.llm-msg-text {
  margin: 0; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; color: var(--text);
  white-space: pre-wrap; word-break: break-word;
}
.llm-input-none { margin-top: 6px; font-size: 11.5px; color: var(--text-dim); }

.llm-list { flex: 1; overflow-y: auto; padding: 8px 10px; }
.llm-empty { color: var(--text-dim); font-size: 13px; padding: 24px 10px; text-align: center; }
.llm-subhead {
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  color: var(--text-dim); padding: 12px 10px 6px; margin-top: 6px;
  border-top: 1px solid var(--border-dim);
}
.llm-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 10px; border-radius: var(--r); margin-bottom: 4px;
}
.llm-row.running { background: color-mix(in srgb, var(--accent) 7%, transparent); }
.llm-row.failed  { background: color-mix(in srgb, var(--red) 7%, transparent); }
.llm-ico { display: flex; margin-top: 1px; flex-shrink: 0; color: var(--text-dim); }
.llm-row.running .llm-ico   { color: var(--accent); }
.llm-row.pending .llm-ico   { color: var(--text-muted); }
.llm-row.done .llm-ico      { color: var(--green); }
.llm-row.failed .llm-ico    { color: var(--red); }
.llm-row.cancelled .llm-ico { color: var(--text-dim); }
.llm-body { flex: 1; min-width: 0; }
.llm-line1 { display: flex; align-items: center; gap: 8px; }
.llm-source { font-size: 13.5px; font-weight: 600; color: var(--text); }
.llm-status { font-size: 11px; color: var(--text-muted); }
.llm-line2 { font-size: 11.5px; color: var(--text-dim); margin-top: 1px; }
.llm-model { font-family: var(--font-mono); }
.llm-err { font-size: 11px; color: var(--red); margin-top: 3px; word-break: break-word; }
.llm-row-cancel {
  background: transparent; border: none; cursor: pointer; color: var(--text-dim);
  display: flex; padding: 4px; border-radius: var(--r-sm); flex-shrink: 0; align-self: center;
}
.llm-row-cancel:hover { background: var(--bg-hover); color: var(--red); }

.spin { animation: llmspin .8s linear infinite; }
@keyframes llmspin { to { transform: rotate(360deg); } }
</style>
