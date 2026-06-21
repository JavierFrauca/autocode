<script setup lang="ts">
import { useAuthStore } from "../stores/auth";

// Vista de inicio del andamiaje. El agente la reemplaza por la primera pantalla real del plan
// (o crea más vistas en ./views y las registra en router.ts + AppSidebar.vue).
const auth = useAuthStore();
</script>

<template>
  <!-- AUTOCODE:PLACEHOLDER — REEMPLAZA esta vista por las pantallas reales del plan (mantén el shell, el login y el router). -->
  <section class="card inicio">
    <h2>Sesión iniciada ✅</h2>
    <p class="muted">
      Has entrado como <strong>{{ auth.usuario?.email }}</strong> ({{ auth.usuario?.rol }}).
      El andamiaje (login + menú lateral + cabecera + router + auditoría) funciona.
      A partir de aquí se construyen las pantallas reales.
    </p>
  </section>
</template>

<style scoped>
.inicio { max-width: 640px; }
.inicio h2 { margin: 0 0 8px; }
</style>
