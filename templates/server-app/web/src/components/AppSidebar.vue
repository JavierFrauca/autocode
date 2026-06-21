<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useUiStore } from "../stores/ui";
import { useAuthStore } from "../stores/auth";

/**
 * Menú lateral (cáscara). Se DERIVA del router: toda ruta con `meta.menu` aparece aquí automáticamente,
 * ordenada por `orden` y agrupada (las `meta.soloAdmin` van en "Administración", solo para admin).
 * Para añadir una pantalla NO toques este fichero — registra su ruta con `meta.menu` en router.ts.
 */
const ui = useUiStore();
const auth = useAuthStore();
const router = useRouter();

interface Entrada { to: string; nombre: string; icono: string; orden: number; admin: boolean }
const entradas = computed<Entrada[]>(() =>
  router.getRoutes()
    .filter((r) => (r.meta as any)?.menu)
    .map((r) => {
      const m = (r.meta as any).menu as { icono: string; orden?: number; label?: string };
      return {
        to: r.path,
        nombre: m.label ?? ((r.meta as any).titulo as string) ?? String(r.name ?? r.path),
        icono: m.icono,
        orden: m.orden ?? 100,
        admin: !!(r.meta as any).soloAdmin,
      };
    })
    .sort((a, b) => a.orden - b.orden),
);
const enlaces = computed(() => entradas.value.filter((e) => !e.admin));
const enlacesAdmin = computed(() => entradas.value.filter((e) => e.admin));

async function salir(): Promise<void> {
  await auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--min': ui.sidebarColapsado }">
    <div class="sidebar__top">
      <span class="sidebar__logo">◆</span>
      <span v-if="!ui.sidebarColapsado" class="sidebar__nombre">Mi aplicación</span>
    </div>

    <nav class="sidebar__nav">
      <router-link v-for="e in enlaces" :key="e.to" :to="e.to" class="sidebar__item" :title="e.nombre">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path :d="e.icono" /></svg>
        <span v-if="!ui.sidebarColapsado" class="sidebar__label">{{ e.nombre }}</span>
      </router-link>

      <template v-if="auth.esAdmin && enlacesAdmin.length">
        <span v-if="!ui.sidebarColapsado" class="sidebar__grupo">Administración</span>
        <router-link v-for="e in enlacesAdmin" :key="e.to" :to="e.to" class="sidebar__item" :title="e.nombre">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path :d="e.icono" /></svg>
          <span v-if="!ui.sidebarColapsado" class="sidebar__label">{{ e.nombre }}</span>
        </router-link>
      </template>
    </nav>

    <div class="sidebar__pie">
      <div v-if="!ui.sidebarColapsado" class="sidebar__usuario">
        <span class="sidebar__avatar">{{ (auth.usuario?.nombre ?? "?").charAt(0).toUpperCase() }}</span>
        <span class="sidebar__udatos">
          <strong>{{ auth.usuario?.nombre }}</strong>
          <small class="muted">{{ auth.usuario?.email }}</small>
        </span>
      </div>
      <button class="sidebar__salir" title="Cerrar sesión" @click="salir">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        <span v-if="!ui.sidebarColapsado">Cerrar sesión</span>
      </button>
      <button class="sidebar__toggle" :title="ui.sidebarColapsado ? 'Expandir' : 'Colapsar'" @click="ui.alternarSidebar()">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path :d="ui.sidebarColapsado ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" /></svg>
        <span v-if="!ui.sidebarColapsado">Colapsar</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar { width: var(--sidebar-w); flex: 0 0 var(--sidebar-w); height: 100%;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; transition: width .15s ease, flex-basis .15s ease; }
.sidebar--min { width: var(--sidebar-w-min); flex-basis: var(--sidebar-w-min); }
.sidebar__top { display: flex; align-items: center; gap: 10px; padding: 18px 16px; height: 60px;
  border-bottom: 1px solid var(--border); }
.sidebar__logo { color: var(--accent); font-size: 20px; }
.sidebar__nombre { font-weight: 700; white-space: nowrap; }
.sidebar__nav { flex: 1; padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.sidebar__grupo { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted);
  padding: 14px 12px 4px; opacity: .8; }
.sidebar__item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius-sm);
  color: var(--text-muted); font-weight: 600; white-space: nowrap; }
.sidebar__item:hover { background: var(--surface-2); color: var(--text); }
.sidebar__item.router-link-active { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.sidebar__pie { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 2px; }
.sidebar__usuario { display: flex; align-items: center; gap: 10px; padding: 8px 8px 4px; }
.sidebar__avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--accent); color: var(--accent-contrast);
  display: grid; place-items: center; font-weight: 700; flex: 0 0 32px; }
.sidebar__udatos { display: flex; flex-direction: column; min-width: 0; }
.sidebar__udatos strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar__udatos small { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar__salir, .sidebar__toggle { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: transparent; border: none; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-sm);
  font: inherit; font-weight: 600; }
.sidebar__salir:hover, .sidebar__toggle:hover { background: var(--surface-2); color: var(--text); }
</style>
