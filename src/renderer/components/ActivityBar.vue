<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const entries = [
  { path: "/projects", label: "Proyectos", glyph: "▣" },
  { path: "/config",   label: "Configuración", glyph: "⚙" },
];

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + "/");
}

function go(path: string) { router.push(path); }
</script>

<template>
  <aside class="activity-bar">
    <div class="activity-logo" title="AutoCode">AC</div>
    <button
      v-for="e in entries"
      :key="e.path"
      class="activity-btn"
      :class="{ active: isActive(e.path) }"
      :title="e.label"
      @click="go(e.path)"
    >
      <span>{{ e.glyph }}</span>
      <span class="tooltip">{{ e.label }}</span>
    </button>
  </aside>
</template>
