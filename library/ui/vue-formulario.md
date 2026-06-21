# Vue 3 — Formulario con validación

**Categoría:** ui | **Cuándo usar:** Crear o editar un registro con validación en cliente

```vue
<script setup lang="ts">
import { reactive, ref } from "vue";

const props = defineProps<{ initial?: Partial<{ nombre: string; email: string }> }>();
const emit = defineEmits<{ (e: "submit", data: { nombre: string; email: string }): void; (e: "cancel"): void }>();

const form = reactive({ nombre: props.initial?.nombre ?? "", email: props.initial?.email ?? "" });
const errors = reactive<Record<string, string>>({});
const loading = ref(false);

function validate(): boolean {
  Object.keys(errors).forEach((k) => delete errors[k]);
  if (!form.nombre.trim()) errors.nombre = "El nombre es obligatorio";
  if (!form.email.includes("@")) errors.email = "Email inválido";
  return Object.keys(errors).length === 0;
}

async function onSubmit() {
  if (!validate() || loading.value) return;
  loading.value = true;
  try {
    emit("submit", { nombre: form.nombre.trim(), email: form.email.trim() });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form @submit.prevent="onSubmit" class="form">
    <div class="field" :class="{ error: errors.nombre }">
      <label>Nombre</label>
      <input v-model="form.nombre" placeholder="Nombre completo" />
      <span v-if="errors.nombre" class="error-msg">{{ errors.nombre }}</span>
    </div>
    <div class="field" :class="{ error: errors.email }">
      <label>Email</label>
      <input v-model="form.email" type="email" placeholder="correo@ejemplo.com" />
      <span v-if="errors.email" class="error-msg">{{ errors.email }}</span>
    </div>
    <div class="form-actions">
      <button type="submit" :disabled="loading">{{ loading ? "Guardando…" : "Guardar" }}</button>
      <button type="button" @click="emit('cancel')">Cancelar</button>
    </div>
  </form>
</template>
```
