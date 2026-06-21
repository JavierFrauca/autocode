<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useAppStore } from "../stores";

const app = useAppStore();
const route = useRoute();
const projectId = computed(() => route.params.projectId as string);

onMounted(async () => {
  if (app.projects.length === 0) await app.refreshProjects();
  app.setCurrentProject(projectId.value);
});
watch(projectId, (id) => app.setCurrentProject(id));
</script>

<template>
  <router-view />
</template>
