<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CheckCircle2, Loader, XCircle, Circle } from "lucide-vue-next";

interface Step { id: string; phase: string; label: string; detail: string | null; status: string }
const props = defineProps<{
  phases: string[];
  steps: Step[];
  currentPhase: string | null;
  status: "running" | "done" | "failed" | string;
}>();

const curIdx = computed(() => props.phases.indexOf(props.currentPhase ?? ""));

const stopped = computed(() =>
  props.status === "failed" || props.status === "needs_input" || props.status === "cancelled",
);

function phaseState(i: number): "done" | "active" | "failed" | "pending" {
  if (props.status === "done")   return "done";
  if (i < curIdx.value)  return "done";
  if (i === curIdx.value) return stopped.value ? "failed" : "active";
  return "pending";
}

const feedEl = ref<HTMLElement | null>(null);
watch(
  () => props.steps.length,
  async () => {
    await nextTick();
    if (feedEl.value) feedEl.value.scrollTop = feedEl.value.scrollHeight;
  },
);
</script>

<template>
  <div class="tunnel">
    <!-- ── Fases (izquierda) ── -->
    <aside class="phases">
      <div v-for="(p, i) in phases" :key="p" class="phase" :class="phaseState(i)">
        <div class="phase-node">
          <CheckCircle2 v-if="phaseState(i) === 'done'"       :size="17" :stroke-width="2" />
          <Loader       v-else-if="phaseState(i) === 'active'" :size="17" :stroke-width="2" class="spin" />
          <XCircle      v-else-if="phaseState(i) === 'failed'" :size="17" :stroke-width="2" />
          <Circle       v-else                                  :size="17" :stroke-width="1.6" />
        </div>
        <span class="phase-label">{{ p }}</span>
      </div>
    </aside>

    <!-- ── Feed de mensajes (derecha) ── -->
    <div class="feed-wrap">
      <div class="feed-title">
        <span v-if="status === 'running'" class="feed-dot running" />
        <CheckCircle2 v-else-if="status === 'done'" :size="14" :stroke-width="2" class="feed-status-ico ok" />
        <XCircle      v-else                        :size="14" :stroke-width="2" class="feed-status-ico err" />
        {{
          status === 'running' ? 'Construyendo tu aplicación…'
          : status === 'done'  ? 'Aplicación construida con éxito'
          : status === 'cancelled' ? 'Construcción cancelada'
          : status === 'needs_input' ? 'Necesita tu ayuda para terminar'
          : 'La construcción se ha detenido'
        }}
      </div>

      <div class="feed" ref="feedEl">
        <div v-if="steps.length === 0 && status === 'running'" class="feed-empty">
          <Loader :size="14" :stroke-width="2" class="spin" style="color:var(--accent)" />
          Preparando…
        </div>
        <div v-for="s in steps" :key="s.id" class="feed-item" :class="s.status">
          <span class="feed-ico">
            <CheckCircle2 v-if="s.status === 'done'"    :size="15" :stroke-width="2" />
            <XCircle      v-else-if="s.status === 'failed'" :size="15" :stroke-width="2" />
            <Loader       v-else                         :size="15" :stroke-width="2" class="spin" />
          </span>
          <div class="feed-body">
            <div class="feed-label">{{ s.label }}</div>
            <div v-if="s.detail" class="feed-detail">{{ s.detail }}</div>
          </div>
          <span class="feed-phase-badge">{{ s.phase }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tunnel {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 24px;
  width: 100%;
  height: 100%;
  min-height: 0;
}

/* ── Fases izquierda ── */
.phases {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  overflow-y: auto;
}
.phase {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
}
.phase:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 15px;
  top: 37px;
  bottom: -8px;
  width: 2px;
  background: var(--border);
  border-radius: 2px;
}
.phase.done:not(:last-child)::after   { background: var(--green); }
.phase.active:not(:last-child)::after { background: linear-gradient(to bottom, var(--accent), var(--border)); }

.phase-node {
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  color: var(--text-dim);
  z-index: 1;
  transition: border-color .3s, color .3s, box-shadow .3s;
}
.phase.done   .phase-node { border-color: var(--green);  color: var(--green); }
.phase.active .phase-node {
  border-color: var(--accent); color: var(--accent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 14%, transparent);
}
.phase.failed .phase-node { border-color: var(--red); color: var(--red); }

.phase-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-dim);
  transition: color .2s;
}
.phase.done   .phase-label { color: var(--text); }
.phase.active .phase-label { color: var(--accent); }
.phase.failed .phase-label { color: var(--red); }

/* ── Feed derecha ── */
.feed-wrap {
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  box-shadow: var(--shadow-sm);
}
.feed-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  padding: 13px 16px;
  border-bottom: 1px solid var(--border-dim);
  flex-shrink: 0;
}
.feed-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.feed-dot.running {
  background: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}
.feed-status-ico        { flex-shrink: 0; }
.feed-status-ico.ok  { color: var(--green); }
.feed-status-ico.err { color: var(--red); }

.feed {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.feed-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  padding: 16px 0;
}
.feed-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r);
  font-size: 13px;
  transition: background .15s;
}
.feed-item.running { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.feed-item.failed  { background: color-mix(in srgb, var(--red) 6%, transparent); }

.feed-ico {
  display: flex; align-items: center;
  margin-top: 1px; flex-shrink: 0;
  color: var(--text-dim);
}
.feed-item.done    .feed-ico { color: var(--green); }
.feed-item.failed  .feed-ico { color: var(--red); }
.feed-item.running .feed-ico { color: var(--accent); }

.feed-body { flex: 1; min-width: 0; }
.feed-label { color: var(--text); line-height: 1.4; }
.feed-item.running .feed-label { color: var(--text-muted); }
.feed-detail {
  font-size: 11.5px;
  color: var(--text-dim);
  margin-top: 2px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.feed-phase-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border-dim);
  border-radius: 20px;
  padding: 2px 8px;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
  white-space: nowrap;
}

.spin { animation: spin .8s linear infinite; }
@keyframes spin  { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { transform: scale(1); opacity:1; } 50% { transform: scale(1.5); opacity:.4; } }
</style>
