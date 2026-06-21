<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { api } from "../api";
import { renderMarkdown } from "../md";
import { Terminal, RotateCcw, Pencil, X as IconX } from "lucide-vue-next";

const promptList = ref<{ name: string; isCustom: boolean }[]>([]);
const selectedPromptName = ref<string | null>(null);
const promptContent = ref("");
const originalContent = ref("");
const promptIsCustom = ref(false);
const promptSaving = ref(false);
const editMode = ref(false);
const saveMsg = ref<string | null>(null);
const editorEl = ref<HTMLTextAreaElement | null>(null);

const isDirty = computed(() => promptContent.value !== originalContent.value);

async function loadPromptList() {
  const r = await api.listPrompts();
  promptList.value = r.prompts ?? [];
}

async function selectPrompt(name: string) {
  if (selectedPromptName.value === name && !editMode.value) return;
  selectedPromptName.value = name;
  editMode.value = false;
  saveMsg.value = null;
  const r = await api.getPrompt(name);
  promptContent.value = r.content;
  originalContent.value = r.content;
  promptIsCustom.value = r.isCustom;
}

function startEdit() {
  editMode.value = true;
  nextTick(() => editorEl.value?.focus());
}

function cancelEdit() {
  promptContent.value = originalContent.value;
  editMode.value = false;
  saveMsg.value = null;
}

async function savePrompt() {
  if (!selectedPromptName.value) return;
  promptSaving.value = true;
  try {
    await api.savePrompt(selectedPromptName.value, promptContent.value);
    originalContent.value = promptContent.value;
    promptIsCustom.value = true;
    editMode.value = false;
    saveMsg.value = "Guardado ✓";
    setTimeout(() => (saveMsg.value = null), 3000);
    const idx = promptList.value.findIndex((p) => p.name === selectedPromptName.value);
    if (idx >= 0) promptList.value[idx] = { name: selectedPromptName.value, isCustom: true };
  } finally { promptSaving.value = false; }
}

async function resetPrompt() {
  if (!selectedPromptName.value) return;
  promptSaving.value = true;
  try {
    const r = await api.resetPrompt(selectedPromptName.value);
    promptContent.value = r.content;
    originalContent.value = r.content;
    promptIsCustom.value = false;
    editMode.value = false;
    const idx = promptList.value.findIndex((p) => p.name === selectedPromptName.value);
    if (idx >= 0) promptList.value[idx] = { name: selectedPromptName.value, isCustom: false };
  } finally { promptSaving.value = false; }
}

onMounted(loadPromptList);
</script>

<template>
  <div class="prompts-shell">

    <!-- ── Lista izquierda ── -->
    <aside class="prompts-tree">
      <div class="prompts-tree-header">
        <span>Prompts de sistema</span>
      </div>

      <div v-if="promptList.length === 0" class="prompts-tree-loading">Cargando…</div>

      <div
        v-for="p in promptList"
        :key="p.name"
        class="prompt-node"
        :class="{ selected: selectedPromptName === p.name }"
        @click="selectPrompt(p.name)"
      >
        <Terminal :size="13" :stroke-width="1.8" class="prompt-node-icon" />
        <span class="prompt-node-name">{{ p.name }}</span>
        <span v-if="p.isCustom" class="badge warn" style="font-size:10px; padding:1px 5px; flex-shrink:0">editado</span>
      </div>
    </aside>

    <!-- ── Visor / editor ── -->
    <div class="prompts-content">
      <template v-if="selectedPromptName">

        <!-- Toolbar -->
        <div class="prompts-toolbar">
          <div class="prompts-breadcrumb">
            <span class="dim">prompts</span>
            <span> / </span>
            <strong>{{ selectedPromptName }}</strong>
            <span v-if="promptIsCustom" class="badge warn" style="font-size:10px; margin-left:6px">personalizado</span>
          </div>
          <div class="spacer" />
          <span v-if="saveMsg" class="save-msg ok">{{ saveMsg }}</span>
          <template v-if="!editMode">
            <button
              class="btn ghost" style="gap:5px"
              :disabled="!promptIsCustom || promptSaving"
              @click="resetPrompt"
            >
              <RotateCcw :size="13" :stroke-width="2" /> Restaurar original
            </button>
            <button class="btn ghost" style="gap:5px" @click="startEdit">
              <Pencil :size="13" :stroke-width="2" /> Editar
            </button>
          </template>
          <template v-else>
            <button class="btn ghost" style="gap:5px" :disabled="promptSaving" @click="cancelEdit">
              <IconX :size="13" /> Cancelar
            </button>
            <button class="btn primary" @click="savePrompt" :disabled="!isDirty || promptSaving">
              {{ promptSaving ? "Guardando…" : "Guardar" }}
            </button>
          </template>
        </div>

        <!-- Cuerpo -->
        <div class="prompts-body">
          <div v-if="!editMode" class="prompt-rendered markdown" v-html="renderMarkdown(promptContent)" />
          <textarea
            v-else
            ref="editorEl"
            v-model="promptContent"
            class="prompt-editor"
            spellcheck="false"
            @keydown.ctrl.s.prevent="savePrompt"
            @keydown.meta.s.prevent="savePrompt"
            @keydown.escape="cancelEdit"
          />
        </div>
      </template>

      <div v-else class="prompts-empty">
        <Terminal :size="48" :stroke-width="1.2" style="opacity:.15; color:var(--text-muted)" />
        <h3>Selecciona un prompt</h3>
        <p class="muted">Elige un prompt de sistema de la lista para verlo y editarlo.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompts-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Lista izquierda ── */
.prompts-tree {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
}
.prompts-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border-dim);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  z-index: 2;
}
.prompts-tree-loading {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--text-dim);
}

.prompt-node {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  transition: background .1s;
  color: var(--text-muted);
}
.prompt-node:hover    { background: var(--bg-hover); color: var(--text); }
.prompt-node.selected { background: var(--accent-bg); color: var(--accent); }
.prompt-node-icon { flex-shrink: 0; color: var(--text-dim); }
.prompt-node.selected .prompt-node-icon { color: var(--accent); }
.prompt-node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 12px;
}

/* ── Contenido ── */
.prompts-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.prompts-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.prompts-breadcrumb {
  font-size: 13px;
  color: var(--text-muted);
}
.prompts-breadcrumb strong { color: var(--text); }
.save-msg { font-size: 12px; }
.save-msg.ok    { color: var(--green); }
.save-msg.error { color: var(--red); }

.prompts-body { flex: 1; overflow: auto; }

.prompt-rendered { padding: 28px 36px; max-width: 780px; }
.prompt-editor {
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 28px 36px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.75;
  background: var(--bg-surface);
  color: var(--text);
  border-radius: 0;
  box-sizing: border-box;
}

.prompts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 24px;
  flex: 1;
  gap: 10px;
  color: var(--text-dim);
}
.prompts-empty h3 { font-size: 16px; color: var(--text); margin: 0; }
.prompts-empty p  { font-size: 14px; max-width: 360px; line-height: 1.6; }
</style>
