<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores";
import {
  MessageCircle, FileText, Rocket, Settings,
  LayoutGrid, Moon, Sun, Minus, Square, X, Wifi, WifiOff, Loader, Play, ImageIcon, Activity, Terminal, BookOpen, LayoutTemplate,
} from "lucide-vue-next";

const route  = useRoute();
const router = useRouter();
const app    = useAppStore();

// Versión de AutoCode (inyectada en build por Vite). `npm run package` la sube automáticamente.
const version = __APP_VERSION__;

const projectId = computed(() => route.params.projectId as string | undefined);
const project   = computed(() =>
  projectId.value ? app.projects.find((p) => p.id === projectId.value) : null,
);
const inProject = computed(() => !!projectId.value);

const services   = computed(() => app.health?.services ?? {});
const allOk      = computed(() => services.value.db && services.value.provider);
const llmRunning = computed(() => !!app.llmActivity?.current);

const statusLabel = computed(() => {
  if (llmRunning.value)        return "IA pensando…";
  if (!services.value.provider) return "IA no conectada";
  if (!services.value.db)      return "Sin conexión";
  return "Listo";
});

const isActiveTab  = (tab: string) => route.path.includes(`/${tab}`);
const isActiveLink = (path: string) =>
  route.path === path || route.path.startsWith(path + "/");

const isElectron = typeof window !== "undefined" && !!(window as any).autocode?.minimize;
function winMinimize() { (window as any).autocode?.minimize(); }
function winMaximize() { (window as any).autocode?.maximize(); }
function winClose()    { (window as any).autocode?.close(); }

// Buscar actualizaciones a mano: el UpdateBanner escucha este evento, comprueba y muestra el resultado.
function buscarActualizaciones() { window.dispatchEvent(new CustomEvent("autocode-check-updates")); }
</script>

<template>
  <header class="topnav">
    <!-- Marca clickeable -->
    <span class="topnav-brand" title="Inicio" @click="router.push('/')">
      Auto<span class="topnav-brand-code">Code</span>
    </span>
    <span
      class="topnav-version"
      :title="`AutoCode v${version} — clic para buscar actualizaciones`"
      role="button"
      @click="buscarActualizaciones"
    >v{{ version }}</span>

    <!-- Dentro de un proyecto -->
    <template v-if="inProject">
      <div class="topnav-divider" />
      <button class="topnav-back" title="Volver a proyectos" @click="router.push('/projects')">
        <LayoutGrid :size="15" :stroke-width="2" />
        {{ project?.name ?? "…" }}
      </button>
      <div class="topnav-divider" />
      <nav class="topnav-tabs">
        <router-link :to="`/projects/${projectId}/chat`" class="topnav-tab" :class="{ active: isActiveTab('chat') }">
          <MessageCircle :size="15" :stroke-width="2" /> Conversar
        </router-link>
        <router-link :to="`/projects/${projectId}/media`" class="topnav-tab" :class="{ active: isActiveTab('media') }">
          <ImageIcon :size="15" :stroke-width="2" /> Recursos
        </router-link>
        <router-link :to="`/projects/${projectId}/docs`" class="topnav-tab" :class="{ active: isActiveTab('docs') }">
          <FileText :size="15" :stroke-width="2" /> Documentos
        </router-link>
        <router-link :to="`/projects/${projectId}/screens`" class="topnav-tab" :class="{ active: isActiveTab('screens') }">
          <LayoutTemplate :size="15" :stroke-width="2" /> Pantallas
        </router-link>
        <router-link :to="`/projects/${projectId}/app`" class="topnav-tab" :class="{ active: isActiveTab('app') }">
          <Rocket :size="15" :stroke-width="2" /> Generar app
        </router-link>
        <router-link :to="`/projects/${projectId}/versions`" class="topnav-tab" :class="{ active: isActiveTab('versions') }">
          <Play :size="15" :stroke-width="2" /> Ejecutar
        </router-link>
      </nav>
    </template>

    <!-- Fuera de proyecto -->
    <template v-else>
      <nav class="topnav-links">
        <router-link to="/projects" class="topnav-link" :class="{ active: isActiveLink('/projects') }">
          <LayoutGrid :size="15" :stroke-width="2" /> Mis proyectos
        </router-link>
        <!-- Ocultos temporalmente (no borrar) — reactivar cambiando v-if a true cuando toque -->
        <template v-if="false">
          <router-link to="/prompts" class="topnav-link" :class="{ active: isActiveLink('/prompts') }">
            <Terminal :size="15" :stroke-width="2" /> Prompts
          </router-link>
          <router-link to="/library" class="topnav-link" :class="{ active: isActiveLink('/library') }">
            <BookOpen :size="15" :stroke-width="2" /> Recursos
          </router-link>
        </template>
      </nav>
    </template>

    <div class="topnav-spacer" />

    <!-- Estado de conexión -->
    <div class="topnav-status">
      <Loader  v-if="llmRunning"        :size="13" :stroke-width="2" class="status-icon spinning" />
      <Wifi    v-else-if="allOk"        :size="13" :stroke-width="2" class="status-icon ok" />
      <WifiOff v-else                   :size="13" :stroke-width="2" class="status-icon error" />
      <span>{{ statusLabel }}</span>
    </div>

    <!-- Ajustes -->
    <button class="topnav-icon-btn" title="Ajustes" @click="router.push('/settings')">
      <Settings :size="16" :stroke-width="2" />
    </button>

    <!-- Actividad de la IA (cola LiteLLM) -->
    <button class="topnav-icon-btn llm-btn" title="Actividad de la IA" @click="app.toggleLlmPanel()">
      <Activity :size="16" :stroke-width="2" />
      <span v-if="llmRunning" class="llm-dot" />
    </button>

    <!-- Toggle tema -->
    <button class="topnav-icon-btn" :title="app.theme === 'light' ? 'Modo oscuro' : 'Modo claro'" @click="app.toggleTheme()">
      <Moon v-if="app.theme === 'light'" :size="16" :stroke-width="2" />
      <Sun  v-else                       :size="16" :stroke-width="2" />
    </button>

    <!-- Controles ventana Electron -->
    <div v-if="isElectron" class="win-controls">
      <button class="win-btn minimize" title="Minimizar" @click="winMinimize"><Minus :size="13" /></button>
      <button class="win-btn maximize" title="Maximizar" @click="winMaximize"><Square :size="11" /></button>
      <button class="win-btn close"    title="Cerrar"    @click="winClose"><X :size="13" /></button>
    </div>
  </header>
</template>

<style scoped>
/* Marca */
.topnav-brand {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -.3px;
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0 4px;
  transition: opacity .15s;
  user-select: none;
  white-space: nowrap;
}
.topnav-brand:hover { opacity: .75; }
.topnav-version {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 999px;
  flex-shrink: 0;
  user-select: none;
  letter-spacing: .2px;
  align-self: center;
  cursor: pointer;
  transition: background .12s, color .12s;
}
.topnav-version:hover { background: var(--bg-active, var(--bg-hover)); color: var(--text); }
.topnav-brand-code {
  background: linear-gradient(120deg, var(--accent) 0%, #A855F7 60%, #EC4899 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 900;
}

/* Iconos de estado */
.status-icon       { flex-shrink: 0; }
.status-icon.ok    { color: var(--green); }
.status-icon.error { color: var(--red); }
.status-icon.spinning {
  color: var(--accent);
  animation: spin .9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Toggle de tema */
.topnav-icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--text-muted);
  transition: background .12s, color .12s;
  flex-shrink: 0;
  margin-left: 6px;
}
.topnav-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
.llm-btn { position: relative; }
.llm-dot {
  position: absolute; top: 5px; right: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent);
  animation: llmpulse 1.1s ease-in-out infinite;
}
@keyframes llmpulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* Controles de ventana Electron */
.win-controls {
  display: flex;
  align-items: center;
  margin-left: 10px;
  gap: 2px;
  flex-shrink: 0;
}
.win-btn {
  width: 34px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--text-muted);
  transition: background .12s, color .12s;
}
.win-btn:hover       { background: var(--bg-hover); color: var(--text); }
.win-btn.close:hover { background: #DC2626; color: white; }
</style>
