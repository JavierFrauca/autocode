<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { api } from "../api";
import { renderMarkdown } from "../md";
import {
  Folder, FolderOpen, FileText, ChevronRight, ChevronDown,
  Pencil, X as IconX, BookOpen, LayoutTemplate, RotateCcw,
} from "lucide-vue-next";

type Source = "library" | "templates";

interface TreeNode {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
}

// ── Árbol ────────────────────────────────────────────────────────────────────
const libraryTree = ref<TreeNode[]>([]);
const templatesTree = ref<TreeNode[]>([]);
const loadingTree = ref(false);
const treeError = ref<string | null>(null);
const collapsedDirs = ref<Set<string>>(new Set());

async function loadTrees() {
  loadingTree.value = true;
  treeError.value = null;
  try {
    const [lib, tpl] = await Promise.all([
      api.libraryTree("library"),
      api.libraryTree("templates"),
    ]);
    libraryTree.value = lib.tree ?? [];
    templatesTree.value = tpl.tree ?? [];
  } catch (e: any) {
    treeError.value = e?.message ?? "Error cargando ficheros";
  } finally {
    loadingTree.value = false;
  }
}

function toggleDir(key: string) {
  const s = new Set(collapsedDirs.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  collapsedDirs.value = s;
}

function flattenNodes(nodes: TreeNode[], source: Source, depth = 0): any[] {
  const out: any[] = [];
  for (const n of nodes) {
    const key = `${source}:${n.path}`;
    out.push({ ...n, source, depth, key });
    if (n.type === "dir" && n.children?.length && !collapsedDirs.value.has(key)) {
      out.push(...flattenNodes(n.children, source, depth + 1));
    }
  }
  return out;
}

const flatLib = computed(() => flattenNodes(libraryTree.value, "library"));
const flatTpl = computed(() => flattenNodes(templatesTree.value, "templates"));

// ── Contenido ────────────────────────────────────────────────────────────────
const selectedKey = ref<string | null>(null);
const selectedSource = ref<Source>("library");
const selectedPath = ref<string | null>(null);
const content = ref("");
const originalContent = ref("");
const contentLoading = ref(false);
const editMode = ref(false);
const saving = ref(false);
const saveMsg = ref<string | null>(null);
const contentError = ref<string | null>(null);
const editorEl = ref<HTMLTextAreaElement | null>(null);

const isDirty = computed(() => content.value !== originalContent.value);

async function openFile(source: Source, filePath: string, key: string) {
  if (selectedKey.value === key) return;
  selectedKey.value = key;
  selectedSource.value = source;
  selectedPath.value = filePath;
  editMode.value = false;
  saveMsg.value = null;
  contentError.value = null;
  contentLoading.value = true;
  try {
    const r = await api.libraryContent(source, filePath);
    content.value = r.content ?? "";
    originalContent.value = r.content ?? "";
  } catch (e: any) {
    contentError.value = e?.message ?? "Error cargando fichero";
  } finally {
    contentLoading.value = false;
  }
}

function startEdit() {
  editMode.value = true;
  nextTick(() => editorEl.value?.focus());
}

function cancelEdit() {
  content.value = originalContent.value;
  editMode.value = false;
  saveMsg.value = null;
}

async function save() {
  if (!selectedPath.value || saving.value) return;
  saving.value = true;
  saveMsg.value = null;
  try {
    await api.saveLibraryContent(selectedSource.value, selectedPath.value, content.value);
    originalContent.value = content.value;
    saveMsg.value = "Guardado ✓";
    editMode.value = false;
    setTimeout(() => (saveMsg.value = null), 3000);
  } catch (e: any) {
    saveMsg.value = "Error: " + (e?.message ?? e);
  } finally {
    saving.value = false;
  }
}

// Nombre legible del fichero (sin extensión, guiones → espacios, capitalizado)
const selectedName = computed(() => {
  if (!selectedPath.value) return "";
  const file = selectedPath.value.split("/").pop() ?? "";
  return file.replace(/\.md$/, "").replace(/-/g, " ");
});

onMounted(loadTrees);
</script>

<template>
  <div class="lib-shell">
    <!-- ── Árbol izquierdo ── -->
    <aside class="lib-tree">

      <!-- Cabecera con recarga -->
      <div class="lib-tree-topbar">
        <span class="lib-tree-title">Recursos</span>
        <button class="lib-reload-btn" :disabled="loadingTree" title="Recargar" @click="loadTrees">
          <RotateCcw :size="12" :stroke-width="2.5" :class="{ spin: loadingTree }" />
        </button>
      </div>

      <div v-if="treeError" class="lib-tree-error">⚠ {{ treeError }}</div>

      <!-- Sección Librería -->
      <div class="lib-section-head" @click="toggleDir('__library__')">
        <BookOpen :size="13" :stroke-width="2" />
        <span>Librería</span>
        <ChevronDown v-if="!collapsedDirs.has('__library__')" :size="12" :stroke-width="2.5" class="lib-chevron-section" />
        <ChevronRight v-else :size="12" :stroke-width="2.5" class="lib-chevron-section" />
      </div>
      <template v-if="!collapsedDirs.has('__library__')">
        <div v-if="loadingTree && flatLib.length === 0" class="lib-tree-loading">Cargando…</div>
        <div
          v-for="node in flatLib"
          :key="node.key"
          class="lib-node"
          :class="[`depth-${node.depth}`, node.type, { selected: selectedKey === node.key }]"
          @click="node.type === 'file' ? openFile('library', node.path, node.key) : toggleDir(node.key)"
        >
          <span class="lib-node-icon">
            <ChevronDown v-if="node.type === 'dir' && !collapsedDirs.has(node.key)" :size="11" :stroke-width="2.5" class="dir-caret" />
            <ChevronRight v-else-if="node.type === 'dir'" :size="11" :stroke-width="2.5" class="dir-caret" />
            <FolderOpen v-if="node.type === 'dir' && !collapsedDirs.has(node.key)" :size="13" :stroke-width="1.8" />
            <Folder     v-else-if="node.type === 'dir'" :size="13" :stroke-width="1.8" />
            <FileText   v-else :size="13" :stroke-width="1.8" />
          </span>
          <span class="lib-node-name">{{ node.name.replace(/\.md$/, '') }}</span>
        </div>
      </template>

      <!-- Sección Templates -->
      <div class="lib-section-head" style="margin-top:6px" @click="toggleDir('__templates__')">
        <LayoutTemplate :size="13" :stroke-width="2" />
        <span>Templates</span>
        <ChevronDown v-if="!collapsedDirs.has('__templates__')" :size="12" :stroke-width="2.5" class="lib-chevron-section" />
        <ChevronRight v-else :size="12" :stroke-width="2.5" class="lib-chevron-section" />
      </div>
      <template v-if="!collapsedDirs.has('__templates__')">
        <div
          v-for="node in flatTpl"
          :key="node.key"
          class="lib-node"
          :class="[`depth-${node.depth}`, node.type, { selected: selectedKey === node.key }]"
          @click="node.type === 'file' ? openFile('templates', node.path, node.key) : toggleDir(node.key)"
        >
          <span class="lib-node-icon">
            <ChevronDown v-if="node.type === 'dir' && !collapsedDirs.has(node.key)" :size="11" :stroke-width="2.5" class="dir-caret" />
            <ChevronRight v-else-if="node.type === 'dir'" :size="11" :stroke-width="2.5" class="dir-caret" />
            <FolderOpen v-if="node.type === 'dir' && !collapsedDirs.has(node.key)" :size="13" :stroke-width="1.8" />
            <Folder     v-else-if="node.type === 'dir'" :size="13" :stroke-width="1.8" />
            <FileText   v-else :size="13" :stroke-width="1.8" />
          </span>
          <span class="lib-node-name">{{ node.name.replace(/\.md$/, '') }}</span>
        </div>
      </template>

    </aside>

    <!-- ── Panel de contenido ── -->
    <div class="lib-content">
      <template v-if="selectedPath">
        <!-- Toolbar -->
        <div class="lib-toolbar">
          <div class="lib-breadcrumb">
            <span class="dim">{{ selectedSource === 'library' ? 'Librería' : 'Templates' }}</span>
            <span> / {{ selectedPath.split('/').slice(0, -1).join(' / ') }}</span>
            <span> / </span><strong>{{ selectedName }}</strong>
          </div>
          <div class="spacer" />
          <span v-if="saveMsg" :class="['save-msg', saveMsg.startsWith('Error') ? 'error' : 'ok']">{{ saveMsg }}</span>
          <template v-if="!editMode">
            <button class="btn ghost" style="gap:5px; font-size:13px" @click="startEdit">
              <Pencil :size="13" :stroke-width="2" /> Editar
            </button>
          </template>
          <template v-else>
            <button class="btn ghost" style="gap:5px; font-size:13px" @click="cancelEdit" :disabled="saving">
              <IconX :size="13" /> Cancelar
            </button>
            <button class="btn primary" style="font-size:13px" @click="save" :disabled="!isDirty || saving">
              {{ saving ? "Guardando…" : "Guardar" }}
            </button>
          </template>
        </div>

        <!-- Cuerpo -->
        <div class="lib-body">
          <div v-if="contentLoading" class="lib-loading">Cargando…</div>
          <div v-else-if="contentError" class="lib-loading" style="color:var(--red)">⚠ {{ contentError }}</div>
          <div v-else-if="!editMode" class="lib-rendered markdown" v-html="renderMarkdown(content)" />
          <textarea
            v-else
            ref="editorEl"
            v-model="content"
            class="lib-editor"
            spellcheck="false"
            placeholder="Contenido Markdown…"
            @keydown.ctrl.s.prevent="save"
            @keydown.meta.s.prevent="save"
          />
        </div>
      </template>

      <!-- Estado vacío -->
      <div v-else class="lib-empty">
        <BookOpen :size="48" :stroke-width="1.2" style="opacity:.15; color:var(--text-muted)" />
        <h3>Selecciona un archivo</h3>
        <p class="muted">Navega por la Librería o los Templates en el panel izquierdo.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lib-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Árbol ── */
.lib-tree {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 12px;
}

.lib-tree-topbar {
  display: flex;
  align-items: center;
  padding: 10px 12px 6px;
  gap: 6px;
}
.lib-tree-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-dim);
  flex: 1;
}
.lib-reload-btn {
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 3px;
  border-radius: var(--r-sm);
}
.lib-reload-btn:hover { color: var(--text); background: var(--bg-hover); }
.lib-reload-btn:disabled { opacity: .4; cursor: default; }
.lib-tree-error {
  font-size: 11px;
  color: var(--red);
  padding: 6px 12px;
  word-break: break-word;
}
.spin { animation: libspin .8s linear infinite; }
@keyframes libspin { to { transform: rotate(360deg); } }

.lib-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 7px;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  border-top: 1px solid var(--border-dim);
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  z-index: 1;
}
.lib-section-head:first-child { border-top: none; }
.lib-section-head:hover { color: var(--text-muted); }
.lib-chevron-section { margin-left: auto; }

.lib-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12.5px;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .1s;
  border-radius: 0;
}
.lib-node.depth-1 { padding-left: 20px; }
.lib-node.depth-2 { padding-left: 32px; }
.lib-node.depth-3 { padding-left: 44px; }
.lib-node.file     { cursor: pointer; }
.lib-node.file:hover    { background: var(--bg-hover); }
.lib-node.file.selected { background: var(--accent-bg); color: var(--accent); }
.lib-node.dir {
  cursor: pointer;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .04em;
  margin-top: 2px;
}
.lib-node.dir:hover { background: var(--bg-hover); }
.lib-node-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.dir-caret { color: var(--text-dim); }
.lib-node-name { overflow: hidden; text-overflow: ellipsis; }

/* ── Contenido ── */
.lib-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.lib-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.lib-breadcrumb {
  font-size: 13px;
  color: var(--text-muted);
  text-transform: capitalize;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-breadcrumb strong { color: var(--text); }
.save-msg { font-size: 12px; }
.save-msg.ok    { color: var(--green); }
.save-msg.error { color: var(--red); }

.lib-body { flex: 1; overflow: auto; }
.lib-loading { padding: 24px; font-size: 13px; color: var(--text-dim); }

.lib-rendered {
  padding: 28px 40px;
  max-width: 820px;
}
.lib-editor {
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
  box-sizing: border-box;
}

.lib-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 24px;
  flex: 1;
  gap: 12px;
  color: var(--text-dim);
}
.lib-empty h3 { font-size: 16px; color: var(--text); margin: 0; }
.lib-empty p  { font-size: 14px; max-width: 340px; line-height: 1.6; }
</style>
