<script setup lang="ts">
const model  = defineModel<string>({ required: true });
const props  = defineProps<{ models: string[]; placeholder?: string }>();
</script>

<template>
  <select v-if="props.models.length" v-model="model" class="model-select">
    <option value="">— elige un modelo —</option>
    <option v-for="m in props.models" :key="m" :value="m">{{ m }}</option>
  </select>
  <input
    v-else
    v-model="model"
    class="model-select"
    :placeholder="props.placeholder ?? 'configura LiteLLM primero'"
    autocomplete="off"
  />
</template>

<style scoped>
.model-select {
  width: 100%;
  background: var(--bg-input, var(--bg-surface));
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  padding: 6px 8px;
  outline: none;
}
.model-select:focus { border-color: var(--cyan); }
select.model-select { cursor: pointer; }
</style>
