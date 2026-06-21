<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppSidebar from "./components/AppSidebar.vue";
import ToastHost from "./components/ToastHost.vue";
import { usePreferenciasStore } from "./stores/preferencias";

/**
 * Raíz del front. Dos layouts:
 *  - Público (login): solo la vista, sin cáscara.
 *  - Privado: cáscara (shell) con menú lateral + cabecera + área de contenido (router-view).
 * La cáscara es infraestructura PERMANENTE — el agente NO la sustituye: añade pantallas como vistas en
 * ./views, las registra en router.ts y en el menú (AppSidebar.vue). Mantén el montaje en #app.
 */
const route = useRoute();
const esPublica = computed(() => route.meta.publica === true);
const titulo = computed(() => (route.meta.titulo as string) ?? "Inicio");
const pref = usePreferenciasStore();
pref.aplicar(); // aplica el tema guardado (claro/oscuro) al arrancar
</script>

<template>
  <ToastHost />
  <router-view v-if="esPublica" />
  <div v-else class="shell">
    <AppSidebar />
    <div class="shell__main">
      <header class="shell__topbar">
        <h1 class="shell__titulo">{{ titulo }}</h1>
        <button class="tema-toggle no-print" :title="pref.tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'" @click="pref.alternar()">
          <svg v-if="pref.tema === 'oscuro'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
      </header>
      <main class="shell__contenido">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100%; }
.shell__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.shell__topbar { height: 60px; flex: 0 0 60px; display: flex; align-items: center; padding: 0 24px;
  border-bottom: 1px solid var(--border); background: var(--surface); }
.shell__titulo { font-size: 1.15rem; margin: 0; }
.shell__contenido { flex: 1; overflow-y: auto; padding: 24px; }
.tema-toggle { margin-left: auto; background: transparent; border: none; color: var(--text-muted);
  cursor: pointer; padding: 8px; border-radius: var(--radius-sm); display: flex; }
.tema-toggle:hover { background: var(--surface-2); color: var(--text); }
</style>
