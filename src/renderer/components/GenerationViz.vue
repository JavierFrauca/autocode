<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from "vue";
import { LayoutDashboard, Smartphone, Scale, Plug, Database, HardDrive } from "lucide-vue-next";

// "electron" usa la viz de escritorio; el resto (server/api/mcp) la de servidor.
const props = defineProps<{ appType: "server" | "electron" | "mcp" | "api" }>();

const ICON: Record<string, any> = markRaw({
  ui: LayoutDashboard,
  screens: Smartphone,
  rules: Scale,
  api: Plug,
  db: Database,
  storage: HardDrive,
});

interface Node { id: string; x: number; y: number; label: string }

const arch = computed<{ nodes: Node[]; edges: [string, string][] }>(() => {
  if (props.appType === "electron") {
    return {
      nodes: [
        { id: "ui", x: 50, y: 16, label: "Interfaz" },
        { id: "screens", x: 26, y: 48, label: "Pantallas" },
        { id: "rules", x: 74, y: 48, label: "Reglas de negocio" },
        { id: "storage", x: 50, y: 83, label: "Almacenamiento local" },
      ],
      edges: [["ui", "screens"], ["ui", "rules"], ["screens", "storage"], ["rules", "storage"]],
    };
  }
  return {
    nodes: [
      { id: "ui", x: 50, y: 13, label: "Interfaz" },
      { id: "screens", x: 26, y: 40, label: "Pantallas" },
      { id: "rules", x: 74, y: 40, label: "Reglas de negocio" },
      { id: "api", x: 50, y: 65, label: "API" },
      { id: "db", x: 50, y: 89, label: "Base de datos" },
    ],
    edges: [["ui", "screens"], ["ui", "rules"], ["screens", "api"], ["rules", "api"], ["api", "db"]],
  };
});

const nodeById = computed(() => Object.fromEntries(arch.value.nodes.map((n) => [n.id, n])));

const MESSAGES = [
  "Leyendo tus documentos…",
  "Diseñando el modelo de datos…",
  "Creando las pantallas…",
  "Conectando la lógica de negocio…",
  "Preparando el almacenamiento…",
  "Ensamblando la aplicación…",
  "Revisando que todo encaje…",
];

const activeStep = ref(0);
const message = ref(MESSAGES[0]!);
let stepTimer: any = null;
let msgTimer: any = null;
let msgIdx = 0;

onMounted(() => {
  const n = arch.value.nodes.length;
  stepTimer = setInterval(() => {
    activeStep.value = (activeStep.value + 1) % (n + 2); // +2 = pausa "todo montado"
  }, 1100);
  msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % MESSAGES.length;
    message.value = MESSAGES[msgIdx]!;
  }, 2600);
});
onBeforeUnmount(() => {
  clearInterval(stepTimer);
  clearInterval(msgTimer);
});

const isBuilt = (i: number) => activeStep.value > i || activeStep.value >= arch.value.nodes.length;
const isActive = (i: number) => activeStep.value === i;
function edgeLive(a: string, b: string): boolean {
  const ia = arch.value.nodes.findIndex((n) => n.id === a);
  const ib = arch.value.nodes.findIndex((n) => n.id === b);
  return isBuilt(Math.max(ia, ib));
}
</script>

<template>
  <div class="viz">
    <div class="viz-head">
      <h2>Construyendo tu aplicación</h2>
      <div class="viz-msg"><span class="viz-msg-dot" />{{ message }}</div>
    </div>

    <div class="viz-canvas">
      <div class="viz-grid" />
      <div class="viz-beam" />

      <!-- Conexiones -->
      <svg class="viz-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          v-for="([a, b], i) in arch.edges"
          :key="i"
          :x1="nodeById[a].x" :y1="nodeById[a].y"
          :x2="nodeById[b].x" :y2="nodeById[b].y"
          class="viz-edge"
          :class="{ live: edgeLive(a, b) }"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <!-- Bloques -->
      <div
        v-for="(n, i) in arch.nodes"
        :key="n.id"
        class="viz-node"
        :class="{ built: isBuilt(i), active: isActive(i) }"
        :style="{ left: n.x + '%', top: n.y + '%', animationDelay: i * 0.18 + 's' }"
      >
        <component :is="ICON[n.id]" class="viz-node-icon" :size="22" :stroke-width="1.7" />
        <span class="viz-node-label">{{ n.label }}</span>
        <span class="viz-node-spark" />
      </div>
    </div>

    <div class="viz-foot">
      <span class="viz-spinner" />
      Esto puede tardar entre 30&nbsp;segundos y 2&nbsp;minutos. No cierres la ventana.
    </div>
  </div>
</template>

<style scoped>
.viz {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
.viz-head { text-align: center; }
.viz-head h2 { font-size: 21px; color: var(--text); margin: 0 0 8px; }
.viz-msg {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13.5px; font-weight: 600; color: var(--accent);
  background: var(--accent-bg, color-mix(in srgb, var(--accent) 12%, transparent));
  border: 1px solid var(--accent-border, color-mix(in srgb, var(--accent) 30%, transparent));
  padding: 5px 14px; border-radius: 999px;
}
.viz-msg-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  animation: pulse 1.1s ease-in-out infinite;
}

/* ── Lienzo ── */
.viz-canvas {
  position: relative;
  aspect-ratio: 16 / 11;
  width: 100%;
  border-radius: var(--r-xl, 18px);
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
    var(--bg-surface);
  border: 1.5px solid var(--border);
  box-shadow: var(--shadow);
}
.viz-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(130% 100% at 50% 40%, #000 55%, transparent 100%);
  opacity: .6;
}
.viz-beam {
  position: absolute; left: 0; right: 0; height: 38%;
  top: -38%;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 22%, transparent), transparent);
  animation: beam 3.6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes beam {
  0%   { top: -40%; opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

/* ── Conexiones ── */
.viz-edges { position: absolute; inset: 0; width: 100%; height: 100%; }
.viz-edge {
  stroke: color-mix(in srgb, var(--text) 18%, transparent);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke .5s;
}
.viz-edge.live {
  stroke: var(--accent);
  stroke-dasharray: 5 6;
  animation: flow 0.9s linear infinite;
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent));
}
@keyframes flow { to { stroke-dashoffset: -22; } }

/* ── Bloques ── */
.viz-node {
  position: absolute;
  transform: translate(-50%, -50%) scale(.6);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 9px 14px;
  min-width: 96px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg, 14px);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  animation: nodeIn .5s cubic-bezier(.2,.9,.3,1.4) forwards;
  z-index: 2;
  transition: border-color .4s, box-shadow .4s, transform .4s;
}
@keyframes nodeIn { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.viz-node-icon  { font-size: 22px; line-height: 1; filter: grayscale(.6) opacity(.7); transition: filter .4s; }
.viz-node-label { font-size: 11.5px; font-weight: 700; color: var(--text-muted); white-space: nowrap; transition: color .4s; }

.viz-node.built {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}
.viz-node.built .viz-node-icon  { filter: none; }
.viz-node.built .viz-node-label { color: var(--text); }

.viz-node.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent), 0 8px 22px color-mix(in srgb, var(--accent) 30%, transparent);
  transform: translate(-50%, -50%) scale(1.08);
  z-index: 3;
}
.viz-node-spark {
  position: absolute; top: -5px; right: -5px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--accent);
  opacity: 0; transform: scale(0);
}
.viz-node.active .viz-node-spark { animation: spark 1.1s ease-out infinite; }
@keyframes spark {
  0%   { opacity: .9; transform: scale(.4); }
  100% { opacity: 0;  transform: scale(2.4); }
}

/* ── Pie ── */
.viz-foot {
  display: flex; align-items: center; justify-content: center; gap: 9px;
  font-size: 12.5px; color: var(--text-muted); text-align: center;
}
.viz-spinner {
  width: 15px; height: 15px; flex-shrink: 0;
  border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin  { to { transform: rotate(360deg); } }
@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: .4; } }
</style>
