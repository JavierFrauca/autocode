<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

const props = defineProps<{
  title: string;
  message: string;
  type?: "confirm" | "alert" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("cancel");
  if (e.key === "Enter") emit("confirm");
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="dlg-backdrop" @click.self="emit('cancel')">
      <div class="dlg" :class="type ?? 'confirm'">
        <div class="dlg-header">
          <span v-if="type === 'danger'" class="dlg-icon danger">⚠️</span>
          <span v-else-if="type === 'alert'" class="dlg-icon info">ℹ️</span>
          <strong class="dlg-title">{{ title }}</strong>
        </div>
        <p class="dlg-msg">{{ message }}</p>
        <div class="dlg-actions">
          <button v-if="type !== 'alert'" class="btn ghost" @click="emit('cancel')">
            {{ cancelLabel ?? "Cancelar" }}
          </button>
          <button
            class="btn"
            :class="type === 'danger' ? 'danger' : 'primary'"
            @click="emit('confirm')"
            autofocus
          >
            {{ confirmLabel ?? (type === "alert" ? "Aceptar" : "Confirmar") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
