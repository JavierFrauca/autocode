<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { useDialog } from "../composables/useDialog";

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);

const tree = ref<any[]>([]);
const selectedPath = ref<string | null>(null);
const content = ref("");
const originalContent = ref("");
const loading = ref(false);
const saving = ref(false);
const saveMsg = ref<string | null>(null);
const showNewForm = ref(false);
const newCategory = ref("decisiones");
const newName = ref("");

const isDirty = computed(() => content.value !== originalContent.value);
const dialog = useDialog();

async function loadTree() {
  loading.value = true;
  try {
    const r = await api.projectFiles(projectId.value);
    tree.value = r.tree ?? [];
  } finally {
    loading.value = false;
  }
}

async function openFile(path: string) {
  selectedPath.value = path;
  const r = await api.getFileContent(projectId.value, path);
  content.value = r.content ?? "";
  originalContent.value = r.content ?? "";
  saveMsg.value = null;
}

async function save() {
  if (!selectedPath.value || saving.value) return;
  saving.value = true;
  saveMsg.value = null;
  try {
    await api.putFile(projectId.value, selectedPath.value, content.value);
    originalContent.value = content.value;
    saveMsg.value = "Guardado y registrado ✓";
    setTimeout(() => (saveMsg.value = null), 3000);
  } catch (e: any) {
    saveMsg.value = "Error: " + (e?.message ?? e);
  } finally {
    saving.value = false;
  }
}

async function deleteFile() {
  if (!selectedPath.value) return;
  const ok = await dialog.danger("Borrar archivo", `¿Borrar "${selectedPath.value}"?\n\nTambién se eliminará de la búsqueda.`);
  if (!ok) return;
  await api.deleteFile(projectId.value, selectedPath.value);
  selectedPath.value = null;
  content.value = "";
  originalContent.value = "";
  await loadTree();
}

async function createFile() {
  if (!newName.value.trim()) return;
  const slug = newName.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const path = `${newCategory.value}/${slug}.md`;
  const initialContent = `# ${newName.value.trim()}\n\n`;
  await api.putFile(projectId.value, path, initialContent);
  showNewForm.value = false;
  newName.value = "";
  await loadTree();
  await openFile(path);
}

onMounted(loadTree);
watch(projectId, loadTree);

function flattenTree(nodes: any[], depth = 0): any[] {
  const result: any[] = [];
  for (const n of nodes) {
    result.push({ ...n, depth });
    if (n.type === "dir" && n.children?.length) {
      result.push(...flattenTree(n.children, depth + 1));
    }
  }
  return result;
}

const flat = computed(() => flattenTree(tree.value));
</script>

<template>
  <div class="decisions-shell">
    <!-- Árbol de ficheros -->
    <aside class="file-tree">
      <div class="file-tree-header">
        <span>Mis Decisiones</span>
        <button class="btn ghost" style="padding: 2px 8px; font-size: 11px" @click="showNewForm = !showNewForm">+ nuevo</button>
      </div>

      <div v-if="showNewForm" class="new-form">
        <select v-model="newCategory" style="width: 100%; margin-bottom: 6px">
          <option value="decisiones">Decisión (ADR)</option>
          <option value="reglas">Regla de negocio</option>
          <option value="pantallas">Pantalla</option>
          <option value="patrones/componentes">Componente Vue</option>
          <option value="patrones/servicios">Servicio</option>
        </select>
        <input v-model="newName" placeholder="Nombre del documento…" @keydown.enter="createFile" autofocus />
        <div class="row" style="margin-top: 6px; gap: 6px">
          <button class="btn primary" style="font-size: 11px; padding: 3px 10px" @click="createFile">Crear</button>
          <button class="btn ghost" style="font-size: 11px; padding: 3px 10px" @click="showNewForm = false">×</button>
        </div>
      </div>

      <div v-if="loading" class="dim" style="padding: 12px 16px; font-size: 11px">Cargando…</div>

      <div v-for="node in flat" :key="node.path"
        :class="['tree-node', `depth-${node.depth}`, node.type, { selected: node.path === selectedPath }]"
        @click="node.type === 'file' && openFile(node.path)"
      >
        <span class="node-icon">{{ node.type === "dir" ? "▸" : "·" }}</span>
        <span class="node-name">{{ node.name }}</span>
      </div>

      <div v-if="!loading && flat.length === 0" class="dim" style="padding: 16px; font-size: 12px; text-align: center">
        Aún no hay documentos.<br/>Conversa con el asistente o crea uno nuevo.
      </div>
    </aside>

    <!-- Editor -->
    <div class="editor-area">
      <template v-if="selectedPath">
        <div class="editor-toolbar">
          <span class="editor-path">{{ selectedPath }}</span>
          <span v-if="saveMsg" class="save-msg" :class="{ error: saveMsg.startsWith('Error') }">{{ saveMsg }}</span>
          <span class="spacer" />
          <button class="btn ghost" style="font-size: 11px; padding: 3px 10px; color: var(--red)" @click="deleteFile">Borrar</button>
          <button class="btn primary" style="font-size: 12px; padding: 4px 14px"
            :disabled="!isDirty || saving" @click="save">
            {{ saving ? "Guardando…" : isDirty ? "Guardar" : "Sin cambios" }}
          </button>
        </div>
        <textarea
          v-model="content"
          class="editor-text"
          spellcheck="false"
          @keydown.ctrl.s.prevent="save"
          @keydown.meta.s.prevent="save"
        />
      </template>
      <div v-else class="editor-empty">
        <div style="font-size: 32px; opacity: 0.2; margin-bottom: 12px">▤</div>
        <p class="muted">Selecciona un documento del árbol izquierdo para editarlo.</p>
        <p class="muted" style="margin-top: 8px; font-size: 12px">
          El asistente genera documentos automáticamente mientras conversas.<br/>
          También puedes crear documentos manualmente con el botón "+ nuevo".
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.decisions-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  flex: 1;
}

.file-tree {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.file-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-dim);
}

.new-form {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-dim);
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: default;
  user-select: none;
}
.tree-node.depth-1 { padding-left: 24px; }
.tree-node.depth-2 { padding-left: 36px; }
.tree-node.depth-3 { padding-left: 48px; }
.tree-node.file { cursor: pointer; }
.tree-node.file:hover { background: var(--bg-hover); }
.tree-node.file.selected { background: var(--bg-active); color: var(--cyan); }
.tree-node.dir { color: var(--text-muted); font-weight: 600; font-size: 11px; margin-top: 6px; }

.node-icon { color: var(--text-dim); flex-shrink: 0; }
.node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.editor-path {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.save-msg {
  font-size: 11px;
  color: var(--green);
}
.save-msg.error { color: var(--red); }

.spacer { flex: 1; }

.editor-text {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  padding: 20px 24px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  background: var(--bg);
  color: var(--text);
  overflow-y: auto;
}

.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
}
</style>
