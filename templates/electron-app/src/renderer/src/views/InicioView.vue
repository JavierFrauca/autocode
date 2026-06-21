<script setup lang="ts">
import { onMounted, ref } from "vue";

// Vista de inicio del andamiaje. El agente la reemplaza por la primera pantalla real del plan
// (o crea más vistas en ./views y las registra en router.ts + AppSidebar.vue).
const estado = ref("comprobando…");

onMounted(async () => {
  try {
    estado.value = (await window.api?.ping?.()) ?? "sin IPC";
  } catch {
    estado.value = "sin IPC";
  }
});
</script>

<template>
  <!-- AUTOCODE:PLACEHOLDER — REEMPLAZA esta vista por las pantallas reales del plan (mantén el shell y el router). -->
  <section class="card inicio">
    <h2>Todo listo ✅</h2>
    <p class="muted">
      El andamiaje (menú lateral + cabecera + router) renderiza correctamente.
      A partir de aquí se construyen las pantallas reales.
    </p>
    <p><span class="pill">IPC: {{ estado }}</span></p>
  </section>
</template>

<style scoped>
.inicio { max-width: 640px; }
.inicio h2 { margin: 0 0 8px; }
</style>
