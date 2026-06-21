<script setup lang="ts">
import { onMounted, watchEffect } from "vue";
import { useAppStore } from "./stores";
import "./style.css";
import TopNav from "./components/TopNav.vue";
import LlmActivityPanel from "./components/LlmActivityPanel.vue";

const app = useAppStore();

// Aplica data-theme al root para que los CSS vars cambien
watchEffect(() => {
  document.documentElement.setAttribute("data-theme", app.theme);
});

onMounted(async () => {
  await app.refreshHealth();
  await app.refreshProjects();
  setInterval(() => app.refreshHealth(), 10000);
  setInterval(() => app.refreshLlmActivity(), 2000);
});
</script>

<template>
  <div class="shell">
    <TopNav />
    <div class="body">
      <router-view />
    </div>
    <LlmActivityPanel />
  </div>
</template>
