<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useUiStore } from "../stores/ui";

/**
 * Menú lateral (cáscara). Se DERIVA del router: toda ruta con `meta.menu` aparece aquí automáticamente,
 * ordenada por `orden`. Para añadir una pantalla NO toques este fichero — registra su ruta con `meta.menu`
 * en router.ts. `icono` es el atributo `d` de un <path> SVG (24x24, trazo, sin librerías).
 */
const ui = useUiStore();
const router = useRouter();

interface Entrada { to: string; nombre: string; icono: string; orden: number }
const enlaces = computed<Entrada[]>(() =>
  router.getRoutes()
    .filter((r) => (r.meta as any)?.menu)
    .map((r) => {
      const m = (r.meta as any).menu as { icono: string; orden?: number; label?: string };
      return {
        to: r.path,
        nombre: m.label ?? ((r.meta as any).titulo as string) ?? String(r.name ?? r.path),
        icono: m.icono,
        orden: m.orden ?? 100,
      };
    })
    .sort((a, b) => a.orden - b.orden),
);
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--min': ui.sidebarColapsado }">
    <div class="sidebar__top">
      <span class="sidebar__logo">◆</span>
      <span v-if="!ui.sidebarColapsado" class="sidebar__nombre">Mi aplicación</span>
    </div>

    <nav class="sidebar__nav">
      <router-link
        v-for="e in enlaces"
        :key="e.to"
        :to="e.to"
        class="sidebar__item"
        :title="e.nombre"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path :d="e.icono" /></svg>
        <span v-if="!ui.sidebarColapsado" class="sidebar__label">{{ e.nombre }}</span>
      </router-link>
    </nav>

    <button class="sidebar__toggle" :title="ui.sidebarColapsado ? 'Expandir' : 'Colapsar'" @click="ui.alternarSidebar()">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path :d="ui.sidebarColapsado ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" />
      </svg>
      <span v-if="!ui.sidebarColapsado">Colapsar</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w); flex: 0 0 var(--sidebar-w); height: 100%;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; transition: width .15s ease, flex-basis .15s ease;
}
.sidebar--min { width: var(--sidebar-w-min); flex-basis: var(--sidebar-w-min); }
.sidebar__top { display: flex; align-items: center; gap: 10px; padding: 18px 16px; height: 60px;
  border-bottom: 1px solid var(--border); }
.sidebar__logo { color: var(--accent); font-size: 20px; }
.sidebar__nombre { font-weight: 700; white-space: nowrap; }
.sidebar__nav { flex: 1; padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.sidebar__item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius-sm);
  color: var(--text-muted); font-weight: 600; white-space: nowrap; }
.sidebar__item:hover { background: var(--surface-2); color: var(--text); }
.sidebar__item.router-link-active { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); }
.sidebar__toggle { display: flex; align-items: center; gap: 10px; margin: 8px; padding: 10px 12px;
  background: transparent; border: none; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-sm);
  font: inherit; font-weight: 600; }
.sidebar__toggle:hover { background: var(--surface-2); color: var(--text); }
</style>
