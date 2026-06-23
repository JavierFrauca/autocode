<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { Download, RefreshCw, X } from "lucide-vue-next";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "progress"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

const updateApi = (window as any).autocode?.update as
  | {
      check: () => Promise<UpdateStatus>;
      install: () => Promise<boolean>;
      getStatus: () => Promise<UpdateStatus>;
      onStatus: (cb: (s: UpdateStatus) => void) => () => void;
    }
  | undefined;

const status = ref<UpdateStatus>({ state: "idle" });
const dismissed = ref(false);
const manualCheck = ref(false); // una comprobación lanzada por el usuario (muestra "al día"/error)
let off: (() => void) | undefined;
let manualTimer: ReturnType<typeof setTimeout> | undefined;

async function comprobar() {
  if (!updateApi) return;
  manualCheck.value = true;
  dismissed.value = false;
  await updateApi.check();
}

onMounted(async () => {
  if (!updateApi) return;
  off = updateApi.onStatus((s) => {
    status.value = s;
    if (s.state === "available" || s.state === "progress" || s.state === "downloaded") dismissed.value = false;
    // Tras una comprobación manual, "al día" o error se muestran un momento y se ocultan solos.
    if (manualCheck.value && (s.state === "not-available" || s.state === "error")) {
      clearTimeout(manualTimer);
      manualTimer = setTimeout(() => (manualCheck.value = false), 4000);
    }
  });
  try {
    status.value = await updateApi.getStatus();
  } catch {
    /* sin updater (modo web/dev): no pasa nada */
  }
  window.addEventListener("autocode-check-updates", comprobar);
});

onUnmounted(() => {
  off?.();
  clearTimeout(manualTimer);
  window.removeEventListener("autocode-check-updates", comprobar);
});

// Mostramos cuando hay versión nueva en juego, o feedback de una comprobación manual.
const visible = computed(() => {
  if (dismissed.value) return false;
  const s = status.value.state;
  if (s === "available" || s === "progress" || s === "downloaded") return true;
  if (manualCheck.value && (s === "checking" || s === "not-available" || s === "error")) return true;
  return false;
});

const installing = ref(false);
async function instalar() {
  installing.value = true;
  await updateApi?.install();
}
</script>

<template>
  <transition name="update-slide">
    <div v-if="visible" class="update-banner" :class="{ ready: status.state === 'downloaded' }">
      <template v-if="status.state === 'available'">
        <Download :size="16" class="ub-icon" />
        <span class="ub-text">Hay una versión nueva (v{{ status.version }}). Descargando…</span>
      </template>

      <template v-else-if="status.state === 'progress'">
        <RefreshCw :size="16" class="ub-icon spin" />
        <span class="ub-text">Descargando la actualización… {{ status.percent }}%</span>
        <div class="ub-bar"><div class="ub-bar-fill" :style="{ width: status.percent + '%' }" /></div>
      </template>

      <template v-else-if="status.state === 'downloaded'">
        <Download :size="16" class="ub-icon" />
        <span class="ub-text">Versión v{{ status.version }} lista para instalar.</span>
        <button class="ub-btn" :disabled="installing" @click="instalar">
          {{ installing ? "Reiniciando…" : "Reiniciar e instalar" }}
        </button>
        <button class="ub-close" title="Más tarde" @click="dismissed = true"><X :size="14" /></button>
      </template>

      <template v-else-if="status.state === 'checking'">
        <RefreshCw :size="16" class="ub-icon spin" />
        <span class="ub-text">Buscando actualizaciones…</span>
      </template>

      <template v-else-if="status.state === 'not-available'">
        <RefreshCw :size="16" class="ub-icon" />
        <span class="ub-text">Ya tienes la última versión.</span>
        <button class="ub-close" title="Cerrar" @click="dismissed = true"><X :size="14" /></button>
      </template>

      <template v-else-if="status.state === 'error'">
        <X :size="16" class="ub-icon" />
        <span class="ub-text">No se pudo comprobar la actualización.</span>
        <button class="ub-close" title="Cerrar" @click="dismissed = true"><X :size="14" /></button>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.update-banner {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  padding: 10px 14px;
  border-radius: var(--r-md, 10px);
  background: var(--bg-elevated, #1b1f27);
  border: 1px solid var(--border, #2a2f3a);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  color: var(--text, #e6e8ee);
  font-size: 13px;
}
.update-banner.ready {
  border-color: var(--accent, #6366f1);
}
.ub-icon { flex-shrink: 0; color: var(--accent, #6366f1); }
.ub-icon.spin { animation: ub-spin 0.9s linear infinite; }
@keyframes ub-spin { to { transform: rotate(360deg); } }
.ub-text { flex: 1; }
.ub-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 3px;
  background: var(--bg-hover, #2a2f3a);
  border-bottom-left-radius: var(--r-md, 10px);
  border-bottom-right-radius: var(--r-md, 10px);
  overflow: hidden;
}
.ub-bar-fill { height: 100%; background: var(--accent, #6366f1); transition: width 0.2s; }
.ub-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  border: none;
  border-radius: var(--r-sm, 6px);
  background: var(--accent, #6366f1);
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.ub-btn:disabled { opacity: 0.6; cursor: default; }
.ub-close {
  flex-shrink: 0;
  display: flex;
  background: transparent;
  border: none;
  color: var(--text-muted, #9aa0ad);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--r-sm, 6px);
}
.ub-close:hover { background: var(--bg-hover, #2a2f3a); color: var(--text, #e6e8ee); }

.update-slide-enter-active,
.update-slide-leave-active { transition: transform 0.25s, opacity 0.25s; }
.update-slide-enter-from,
.update-slide-leave-to { transform: translateY(12px); opacity: 0; }
</style>
