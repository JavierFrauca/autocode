<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { renderMarkdown } from "../md";
import { useDialog } from "../composables/useDialog";
import {
  Folder, FolderOpen, FileText, Pencil, Trash2, Plus,
  X as IconX, Search, ChevronRight, ChevronDown, Sparkles, RotateCcw, History,
} from "lucide-vue-next";

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);
const dialog = useDialog();

const tree = ref<any[]>([]);
const selectedPath = ref<string | null>(null);
const content = ref("");
const originalContent = ref("");
const loading = ref(false);
const saving = ref(false);
const saveMsg = ref<string | null>(null);
const editMode = ref(false);
const showNewForm = ref(false);
const newCategory = ref("reglas");
const newName = ref("");
const editorEl = ref<HTMLTextAreaElement | null>(null);

// Carpetas colapsadas
const collapsedDirs = ref<Set<string>>(new Set());

// Búsqueda
const searchQuery = ref("");
const searchResults = ref<any[]>([]);
const searchLoading = ref(false);
const semanticMode = ref(false);
const searchInputEl = ref<HTMLInputElement | null>(null);

const isDirty = computed(() => content.value !== originalContent.value);

const CATEGORIES: { value: string; label: string }[] = [
  { value: "reglas",    label: "Regla de negocio" },
  { value: "pantallas", label: "Pantalla / vista" },
  { value: "dominios",  label: "Dominio / entidad" },
  { value: "procesos",  label: "Proceso" },
];

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
  editMode.value = false;
  // Reset de la maqueta al cambiar de documento: siempre se abre en modo Spec.
  viewMode.value = "spec";
  mockupHtml.value = null;
  mockupExists.value = false;
  mockupStale.value = false;
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
    saveMsg.value = "Guardado ✓";
    editMode.value = false;
    setTimeout(() => (saveMsg.value = null), 3000);
  } catch (e: any) {
    saveMsg.value = "Error: " + (e?.message ?? e);
  } finally {
    saving.value = false;
  }
}

async function deleteFile() {
  if (!selectedPath.value) return;
  const ok = await dialog.danger(
    "Borrar documento",
    `¿Borrar "${selectedPath.value.split("/").pop()}"?\n\nSe eliminará también de la búsqueda semántica.`,
    { confirmLabel: "Sí, borrar" },
  );
  if (!ok) return;
  await api.deleteFile(projectId.value, selectedPath.value);
  selectedPath.value = null;
  content.value = "";
  originalContent.value = "";
  editMode.value = false;
  await loadTree();
}

async function createFile() {
  if (!newName.value.trim()) return;
  const slug = newName.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const path = `${newCategory.value}/${slug}.md`;
  const initial = `# ${newName.value.trim()}\n\n`;
  await api.putFile(projectId.value, path, initial);
  showNewForm.value = false;
  newName.value = "";
  await loadTree();
  await openFile(path);
  editMode.value = true;
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

// ── Árbol colapsable ──────────────────────────────────────────────────────────
function toggleDir(dirPath: string) {
  const s = new Set(collapsedDirs.value);
  if (s.has(dirPath)) s.delete(dirPath);
  else s.add(dirPath);
  collapsedDirs.value = s;
}

function flattenTree(nodes: any[], depth = 0): any[] {
  const result: any[] = [];
  for (const n of nodes) {
    result.push({ ...n, depth });
    if (n.type === "dir" && n.children?.length && !collapsedDirs.value.has(n.path)) {
      result.push(...flattenTree(n.children, depth + 1));
    }
  }
  return result;
}

const flat = computed(() => flattenTree(tree.value));

const filteredFlat = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q || semanticMode.value) return flat.value;
  // En modo texto: mostrar solo ficheros que coincidan, siempre visibles (sin respetar collapse)
  return flatAllFiles(tree.value).filter(n => n.name.toLowerCase().includes(q));
});

function flatAllFiles(nodes: any[], depth = 0): any[] {
  const result: any[] = [];
  for (const n of nodes) {
    if (n.type === "file") result.push({ ...n, depth: 0 });
    else if (n.children?.length) result.push(...flatAllFiles(n.children, depth + 1));
  }
  return result;
}

// ── Búsqueda semántica ────────────────────────────────────────────────────────
async function performSearch() {
  const q = searchQuery.value.trim();
  if (!q) return;
  semanticMode.value = true;
  searchLoading.value = true;
  searchResults.value = [];
  try {
    const r = await api.searchDocs(projectId.value, q);
    searchResults.value = r.hits ?? [];
  } catch {
    searchResults.value = [];
  } finally {
    searchLoading.value = false;
  }
}

function clearSearch() {
  searchQuery.value = "";
  searchResults.value = [];
  semanticMode.value = false;
  nextTick(() => searchInputEl.value?.focus());
}

function exitSemanticMode() {
  semanticMode.value = false;
  searchResults.value = [];
}

watch(searchQuery, (q) => {
  if (!q.trim()) {
    searchResults.value = [];
    semanticMode.value = false;
  }
});

const selectedName = computed(() => {
  if (!selectedPath.value) return "";
  const parts = selectedPath.value.split("/");
  const file = parts[parts.length - 1] ?? "";
  return file.replace(/\.md$/, "").replace(/-/g, " ");
});

function scoreColor(score: number) {
  if (score >= 0.85) return "var(--green)";
  if (score >= 0.70) return "var(--yellow)";
  return "var(--text-dim)";
}

// ── Maqueta de pantalla (boceto HTML) ─────────────────────────────────────────
const isScreen = computed(() => !!selectedPath.value && selectedPath.value.startsWith("pantallas/"));
const viewMode = ref<"spec" | "mockup">("spec");
const mockupHtml = ref<string | null>(null);
const mockupExists = ref(false);
const mockupStale = ref(false);
const mockupLoading = ref(false);
const mockupGenerating = ref(false);

async function loadMockup() {
  if (!selectedPath.value || !isScreen.value) return;
  mockupLoading.value = true;
  try {
    const r = await api.getScreenMockup(projectId.value, selectedPath.value);
    mockupExists.value = r.exists;
    mockupHtml.value = r.html;
    mockupStale.value = r.stale;
  } catch {
    mockupExists.value = false;
    mockupHtml.value = null;
  } finally {
    mockupLoading.value = false;
  }
}

async function regenerateMockup() {
  if (!selectedPath.value || mockupGenerating.value) return;
  mockupGenerating.value = true;
  saveMsg.value = null;
  try {
    const r = await api.generateScreenMockup(projectId.value, selectedPath.value);
    mockupHtml.value = r.html;
    mockupExists.value = !!r.html;
    mockupStale.value = false;
  } catch (e: any) {
    saveMsg.value = "Error: no se pudo generar la maqueta (" + (e?.message ?? e) + ")";
  } finally {
    mockupGenerating.value = false;
  }
}

function setViewMode(m: "spec" | "mockup") {
  viewMode.value = m;
  if (m === "mockup" && !mockupExists.value && !mockupLoading.value) loadMockup();
}

// ── Historial de revisiones ───────────────────────────────────────────────────
const showHistory = ref(false);
const revisions = ref<any[]>([]);
const revLoading = ref(false);
const restoringRevId = ref<string | null>(null);

async function loadRevisions() {
  if (!selectedPath.value) return;
  revLoading.value = true;
  revisions.value = [];
  try {
    const r = await api.getDocRevisions(projectId.value, selectedPath.value);
    revisions.value = r.revisions ?? [];
  } finally {
    revLoading.value = false;
  }
}

async function restoreRevision(revId: string) {
  if (!selectedPath.value) return;
  restoringRevId.value = revId;
  try {
    await api.restoreDocRevision(projectId.value, selectedPath.value, revId);
    await openFile(selectedPath.value);
    showHistory.value = false;
  } finally {
    restoringRevId.value = null;
  }
}

function toggleHistory() {
  showHistory.value = !showHistory.value;
  if (showHistory.value) loadRevisions();
}

function revAuthorLabel(role: string) {
  if (role === "user") return "Tú";
  if (role === "assistant") return "IA";
  return role;
}

onMounted(loadTree);
watch(projectId, loadTree);
</script>

<template>
  <div class="docs-shell">
    <!-- ── Árbol de documentos ── -->
    <aside class="docs-tree">
      <div class="docs-tree-header">
        <span>Documentos</span>
        <div style="display:flex; align-items:center; gap:4px">
          <button class="btn ghost" style="padding:3px 7px; font-size:12px; display:inline-flex; align-items:center" :title="'Recargar'" @click="loadTree">
            <RotateCcw :size="12" :stroke-width="2.5" />
          </button>
          <button class="btn ghost" style="padding:3px 8px; font-size:12px; display:inline-flex; align-items:center; gap:4px" @click="showNewForm = !showNewForm">
            <Plus :size="13" :stroke-width="2.5" /> nuevo
          </button>
        </div>
      </div>

      <!-- Buscador -->
      <div class="docs-search-wrap">
        <Search :size="13" :stroke-width="2" class="docs-search-icon" />
        <input
          ref="searchInputEl"
          v-model="searchQuery"
          class="docs-search-input"
          placeholder="Buscar… (Enter = semántico)"
          @keydown.enter.prevent="performSearch"
          @keydown.escape="clearSearch"
        />
        <button v-if="searchQuery" class="docs-search-clear" @click="clearSearch" title="Limpiar">
          <IconX :size="12" :stroke-width="2.5" />
        </button>
      </div>

      <!-- Formulario de nuevo documento -->
      <div v-if="showNewForm" class="new-doc-form">
        <div class="field" style="margin-bottom:10px">
          <label class="field-label" style="font-size:12px">Tipo de documento</label>
          <select v-model="newCategory" style="font-size:13px; padding:6px 10px">
            <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label class="field-label" style="font-size:12px">Nombre</label>
          <input v-model="newName" placeholder="Nombre del documento…" @keydown.enter="createFile" autofocus style="font-size:13px" />
        </div>
        <div class="row" style="gap:6px">
          <button class="btn primary" style="font-size:12px; padding:5px 12px" @click="createFile" :disabled="!newName.trim()">Crear</button>
          <button class="btn ghost" style="font-size:12px; padding:5px 10px" @click="showNewForm = false; newName = ''">Cancelar</button>
        </div>
      </div>

      <div v-if="loading && flat.length === 0" class="docs-tree-loading">Cargando…</div>

      <!-- ── Resultados semánticos ── -->
      <template v-if="semanticMode">
        <div class="semantic-header">
          <Sparkles :size="12" :stroke-width="2" />
          Búsqueda semántica
          <button class="semantic-back" @click="exitSemanticMode" title="Volver al árbol">
            <IconX :size="11" :stroke-width="2.5" />
          </button>
        </div>
        <div v-if="searchLoading" class="docs-tree-loading">Buscando…</div>
        <div v-else-if="searchResults.length === 0" class="docs-tree-empty">
          <p>Sin resultados para "{{ searchQuery }}"</p>
        </div>
        <div
          v-else
          v-for="hit in searchResults"
          :key="hit.documentId + hit.text"
          class="search-hit"
          :class="{ selected: hit.path === selectedPath }"
          @click="openFile(hit.path)"
        >
          <div class="search-hit-top">
            <FileText :size="12" :stroke-width="1.8" class="search-hit-icon" />
            <span class="search-hit-title">{{ hit.title || hit.path }}</span>
            <span class="search-hit-score" :style="{ color: scoreColor(hit.score) }">{{ Math.round(hit.score * 100) }}%</span>
          </div>
          <p class="search-hit-snippet">{{ hit.text?.slice(0, 110) }}…</p>
        </div>
      </template>

      <!-- ── Árbol normal / filtrado por nombre ── -->
      <template v-else>
        <div
          v-for="node in filteredFlat"
          :key="node.path"
          :class="['doc-node', `depth-${node.depth}`, node.type, { selected: node.path === selectedPath }]"
          @click="node.type === 'file' ? openFile(node.path) : toggleDir(node.path)"
        >
          <span class="doc-node-icon">
            <ChevronDown v-if="node.type === 'dir' && !collapsedDirs.has(node.path)" :size="12" :stroke-width="2.5" class="dir-chevron" />
            <ChevronRight v-else-if="node.type === 'dir'" :size="12" :stroke-width="2.5" class="dir-chevron" />
            <FolderOpen v-if="node.type === 'dir' && !collapsedDirs.has(node.path)" :size="13" :stroke-width="1.8" />
            <Folder     v-else-if="node.type === 'dir'"                               :size="13" :stroke-width="1.8" />
            <FileText   v-else                                                         :size="13" :stroke-width="1.8" />
          </span>
          <span class="doc-node-name">{{ node.name.replace(/\.md$/, '') }}</span>
        </div>

        <div v-if="!loading && filteredFlat.length === 0 && !showNewForm" class="docs-tree-empty">
          <template v-if="searchQuery">
            <p>Sin resultados para "{{ searchQuery }}"</p>
            <p style="margin-top:6px">Pulsa Enter para búsqueda semántica</p>
          </template>
          <template v-else>
            <p>No hay documentos todavía.</p>
            <p>Habla con la IA y ella los irá generando automáticamente.</p>
          </template>
        </div>
      </template>
    </aside>

    <!-- ── Visor / editor ── -->
    <div class="docs-content">
      <template v-if="selectedPath">
        <div class="doc-toolbar">
          <div class="doc-breadcrumb">
            <span class="dim">{{ selectedPath.split('/').slice(0, -1).join(' / ') }}</span>
            <span v-if="selectedPath.includes('/')"> / </span>
            <strong>{{ selectedName }}</strong>
          </div>

          <!-- Toggle Spec / Maqueta (solo en pantallas) -->
          <div v-if="isScreen" class="view-toggle">
            <button :class="{ active: viewMode === 'spec' }" @click="setViewMode('spec')">Spec</button>
            <button :class="{ active: viewMode === 'mockup' }" @click="setViewMode('mockup')">Maqueta</button>
          </div>

          <div class="spacer" />
          <span v-if="saveMsg" :class="['save-msg', saveMsg.startsWith('Error') ? 'error' : 'ok']">{{ saveMsg }}</span>

          <!-- Acciones en modo Maqueta -->
          <template v-if="isScreen && viewMode === 'mockup'">
            <span class="mockup-tag">Boceto · no funcional</span>
            <span v-if="mockupStale && mockupExists" class="mockup-stale" title="El spec cambió desde que se generó">desactualizada</span>
            <button class="btn ghost" style="gap:5px" :disabled="mockupGenerating" @click="regenerateMockup">
              <Sparkles :size="13" :stroke-width="2" />
              {{ mockupGenerating ? "Generando…" : (mockupExists ? "Regenerar" : "Generar") }}
            </button>
          </template>

          <!-- Acciones en modo Spec -->
          <template v-else-if="!editMode">
            <button class="btn ghost" style="gap:5px" :class="{ 'btn-active': showHistory }" @click="toggleHistory">
              <History :size="13" :stroke-width="2" /> Historial
            </button>
            <button class="btn ghost" style="gap:5px" @click="startEdit"><Pencil :size="13" :stroke-width="2" /> Editar</button>
            <button class="btn ghost" style="gap:5px; color:var(--red)" @click="deleteFile"><Trash2 :size="13" :stroke-width="2" /> Borrar</button>
          </template>
          <template v-else>
            <button class="btn ghost" style="gap:5px" @click="cancelEdit" :disabled="saving"><IconX :size="13" /> Cancelar</button>
            <button class="btn primary" @click="save" :disabled="!isDirty || saving">
              {{ saving ? "Guardando…" : "Guardar" }}
            </button>
          </template>
        </div>

        <div class="doc-body">
          <!-- Modo Maqueta: boceto en iframe AISLADO (sandbox sin scripts; HTML no confiable) -->
          <template v-if="isScreen && viewMode === 'mockup'">
            <div v-if="mockupLoading || mockupGenerating" class="mockup-state">
              {{ mockupGenerating ? "Generando la maqueta…" : "Cargando…" }}
            </div>
            <iframe
              v-else-if="mockupExists"
              class="mockup-frame"
              sandbox=""
              :srcdoc="mockupHtml ?? ''"
            />
            <div v-else class="mockup-state mockup-empty">
              <p>Esta pantalla aún no tiene maqueta.</p>
              <button class="btn primary" style="gap:6px" :disabled="mockupGenerating" @click="regenerateMockup">
                <Sparkles :size="14" :stroke-width="2" /> Generar maqueta
              </button>
            </div>
          </template>

          <!-- Modo Spec: markdown / editor -->
          <template v-else>
            <div v-if="!editMode" class="doc-rendered markdown" v-html="renderMarkdown(content)" />
            <textarea
              v-else
              ref="editorEl"
              v-model="content"
              class="doc-editor"
              spellcheck="false"
              placeholder="Escribe el contenido en Markdown…"
              @keydown.ctrl.s.prevent="save"
              @keydown.meta.s.prevent="save"
            />
          </template>

          <!-- Panel de historial de revisiones -->
          <div v-if="showHistory && !editMode" class="revisions-panel">
            <div class="revisions-header">
              <History :size="14" :stroke-width="2" />
              <span>Historial</span>
              <button class="docs-search-clear" @click="showHistory = false" title="Cerrar">
                <IconX :size="12" :stroke-width="2.5" />
              </button>
            </div>
            <div v-if="revLoading" class="revisions-loading">Cargando…</div>
            <div v-else-if="revisions.length === 0" class="revisions-empty">Sin revisiones guardadas</div>
            <div v-else class="revisions-list">
              <div v-for="(rev, i) in revisions" :key="rev.id" class="revision-item">
                <div class="revision-meta">
                  <span class="revision-author" :class="rev.authorRole">{{ revAuthorLabel(rev.authorRole) }}</span>
                  <span class="revision-date dim">{{ new Date(rev.createdAt.includes('T') ? rev.createdAt : rev.createdAt.replace(' ', 'T') + 'Z').toLocaleString() }}</span>
                  <span v-if="i === 0" class="badge ok" style="font-size:10px">actual</span>
                </div>
                <p class="revision-preview dim">{{ rev.preview }}…</p>
                <button
                  v-if="i > 0"
                  class="btn ghost" style="font-size:11px; padding:3px 10px; gap:5px; margin-top:4px"
                  :disabled="restoringRevId === rev.id"
                  @click="restoreRevision(rev.id)"
                >
                  <RotateCcw :size="11" :stroke-width="2.5" />
                  {{ restoringRevId === rev.id ? "Restaurando…" : "Restaurar esta versión" }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="docs-empty">
        <FileText :size="48" :stroke-width="1.2" style="opacity:.2; color:var(--text-muted)" />
        <h3>Selecciona un documento</h3>
        <p class="muted">La IA genera documentos automáticamente mientras conversas. También puedes crear uno manualmente.</p>
        <button class="btn primary" style="margin-top:16px" @click="showNewForm = true">
          + Crear documento
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docs-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Árbol ── */
.docs-tree {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
}
.docs-tree-header {
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

/* ── Buscador ── */
.docs-search-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border-dim);
  background: var(--bg-surface);
  position: sticky;
  top: 43px;
  z-index: 2;
}
.docs-search-icon { color: var(--text-dim); flex-shrink: 0; }
.docs-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text);
  font-family: inherit;
  min-width: 0;
}
.docs-search-input::placeholder { color: var(--text-dim); }
.docs-search-clear {
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 2px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
}
.docs-search-clear:hover { color: var(--text); background: var(--bg-hover); }

/* ── Resultados semánticos ── */
.semantic-header {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--accent);
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--border-dim);
}
.semantic-back {
  margin-left: auto;
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 2px 3px;
  border-radius: var(--r-sm);
}
.semantic-back:hover { color: var(--text); background: var(--bg-hover); }

.search-hit {
  padding: 9px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-dim);
  transition: background .1s;
}
.search-hit:hover    { background: var(--bg-hover); }
.search-hit.selected { background: var(--accent-bg); }
.search-hit-top {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}
.search-hit-icon { color: var(--text-dim); flex-shrink: 0; }
.search-hit-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-transform: capitalize;
}
.search-hit-score {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  flex-shrink: 0;
}
.search-hit-snippet {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.new-doc-form {
  padding: 12px;
  border-bottom: 1px solid var(--border-dim);
  background: var(--bg);
}
.docs-tree-loading { padding: 14px 12px; font-size: 12px; color: var(--text-dim); }
.docs-tree-empty {
  padding: 20px 14px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
}
.docs-tree-empty p + p { margin-top: 6px; }

/* ── Nodos del árbol ── */
.doc-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .1s;
}
.doc-node.depth-1 { padding-left: 20px; }
.doc-node.depth-2 { padding-left: 32px; }
.doc-node.file     { cursor: pointer; }
.doc-node.file:hover    { background: var(--bg-hover); }
.doc-node.file.selected { background: var(--accent-bg); color: var(--accent); }
.doc-node.dir {
  cursor: pointer;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 11px;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.doc-node.dir:hover { background: var(--bg-hover); }
.doc-node-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
}
.dir-chevron { color: var(--text-dim); }
.doc-node-name { overflow: hidden; text-overflow: ellipsis; }

/* ── Contenido ── */
.docs-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
.doc-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.doc-breadcrumb {
  font-size: 13px;
  color: var(--text-muted);
  text-transform: capitalize;
}
.doc-breadcrumb strong { color: var(--text); }
.save-msg { font-size: 12px; }
.save-msg.ok    { color: var(--green); }
.save-msg.error { color: var(--red); }

.doc-body { flex: 1; overflow: auto; position: relative; }

/* ── Toggle Spec / Maqueta ── */
.view-toggle {
  display: inline-flex;
  margin-left: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md, 8px);
  overflow: hidden;
}
.view-toggle button {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  cursor: pointer;
}
.view-toggle button + button { border-left: 1px solid var(--border); }
.view-toggle button:hover { background: var(--bg-hover); color: var(--text); }
.view-toggle button.active { background: var(--accent-bg); color: var(--accent); }

.mockup-tag {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 600;
  letter-spacing: .02em;
}
.mockup-stale {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 14%, transparent);
}

/* ── Maqueta: iframe aislado y estados ── */
.mockup-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #0f172a; /* fondo del tema slate del andamiaje, evita flash blanco */
}
.mockup-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}
.mockup-empty p { margin: 0; }

/* ── Historial de revisiones ── */
.btn-active { background: var(--accent-bg) !important; color: var(--accent) !important; }

.revisions-panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 300px;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 5;
}
.revisions-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-dim);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dim);
  flex-shrink: 0;
}
.revisions-header span { flex: 1; }
.revisions-loading, .revisions-empty {
  padding: 16px 14px;
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
}
.revisions-list { flex: 1; overflow-y: auto; }
.revision-item {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-dim);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.revision-item:last-child { border-bottom: none; }
.revision-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.revision-author {
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: var(--r-sm);
  background: var(--bg-active); color: var(--text-muted);
}
.revision-author.user { background: var(--accent-bg); color: var(--accent); }
.revision-author.assistant { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.revision-date { font-size: 10.5px; }
.revision-preview {
  font-size: 11px; line-height: 1.5; margin: 0;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}
.doc-rendered { padding: 28px 36px; max-width: 780px; }
.doc-editor {
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


.docs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 24px;
  flex: 1;
  gap: 10px;
}
.docs-empty h3 { font-size: 16px; color: var(--text); margin: 0; }
.docs-empty p  { font-size: 14px; max-width: 360px; line-height: 1.6; }
</style>
