<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, type ScreenMapNode } from "../api";
import { renderMarkdown } from "../md";
import {
  Sparkles, Plus, AppWindow, Monitor, Wand2, RefreshCw, Trash2, Loader2, ImageOff, FileText, ArrowRightLeft, Images,
} from "lucide-vue-next";

interface NodeStatus { hasScreen: boolean; mockupExists: boolean; stale: boolean; path: string }

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);

const tree = ref<ScreenMapNode[]>([]);
const status = ref<Record<string, NodeStatus>>({});
const loading = ref(true);
const error = ref<string | null>(null);
const selectedSlug = ref<string | null>(null);
const defining = ref(false);
const generatingAll = ref(false);
const saving = ref(false);
let pollTimer: any = null;

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Árbol (del MAPA) ──────────────────────────────────────────────────────────
const flatTree = computed(() => {
  const out: (ScreenMapNode & { depth: number })[] = [];
  const walk = (ns: ScreenMapNode[], depth: number) => {
    for (const n of ns) { out.push({ ...n, depth }); if (n.children?.length) walk(n.children, depth + 1); }
  };
  walk(tree.value, 0);
  return out;
});
const pages = computed(() => tree.value); // páginas de primer nivel (posibles padres de un modal)

function findNode(slug: string, ns: ScreenMapNode[] = tree.value): ScreenMapNode | null {
  for (const n of ns) { if (n.slug === slug) return n; const c = findNode(slug, n.children); if (c) return c; }
  return null;
}
function removeNode(slug: string, ns: ScreenMapNode[] = tree.value): ScreenMapNode | null {
  const i = ns.findIndex((n) => n.slug === slug);
  if (i >= 0) return ns.splice(i, 1)[0]!;
  for (const n of ns) { const r = removeNode(slug, n.children); if (r) return r; }
  return null;
}
function parentOf(slug: string, ns: ScreenMapNode[] = tree.value, parent: string | null = null): string | null | false {
  for (const n of ns) {
    if (n.slug === slug) return parent;
    const r = parentOf(slug, n.children, n.slug);
    if (r !== false) return r;
  }
  return false;
}
function findNodeParent(slug: string): string | null {
  const r = parentOf(slug);
  return r === false ? null : r;
}

const selected = computed(() => (selectedSlug.value ? findNode(selectedSlug.value) : null));
const selStatus = computed<NodeStatus | null>(() => (selectedSlug.value ? status.value[selectedSlug.value] ?? null : null));
const selPath = computed(() => selStatus.value?.path ?? (selectedSlug.value ? `pantallas/${selectedSlug.value}.md` : null));

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.getScreenMap(projectId.value);
    tree.value = r.tree;
    status.value = r.status;
    if (selectedSlug.value && !findNode(selectedSlug.value)) selectedSlug.value = null;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

/** Guarda el árbol entero → el servidor escribe el mapa y materializa (crea nuevas, borra huérfanas). */
async function saveTree() {
  saving.value = true;
  error.value = null;
  try {
    await api.saveScreenMap(projectId.value, tree.value);
    await load();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    await load();
  } finally {
    saving.value = false;
  }
}

// ── Alta / jerarquía / borrado (editan el MAPA) ───────────────────────────────
const addMode = ref<null | "pagina" | "modal">(null);
const addName = ref("");
const addParent = ref<string | null>(null);
function startAdd(kind: "pagina" | "modal") {
  addMode.value = kind;
  addName.value = "";
  addParent.value = kind === "modal" ? (selected.value?.kind === "pagina" ? selected.value.slug : pages.value[0]?.slug ?? null) : null;
}
async function confirmAdd() {
  const name = addName.value.trim();
  if (!name || !addMode.value) return;
  const node: ScreenMapNode = { slug: slugify(name), name, kind: addMode.value, children: [] };
  if (addMode.value === "modal" && addParent.value) {
    const p = findNode(addParent.value);
    (p ? p.children : tree.value).push(node);
  } else {
    tree.value.push(node);
  }
  addMode.value = null;
  selectedSlug.value = node.slug;
  await saveTree();
}

async function removeSelected(node: ScreenMapNode) {
  if (!confirm(`¿Quitar «${node.name}» del mapa? Se borrará su pantalla y su maqueta.`)) return;
  removeNode(node.slug);
  if (selectedSlug.value === node.slug) selectedSlug.value = null;
  await saveTree();
}

async function setHierarchy(node: ScreenMapNode, kind: "pagina" | "modal", parentSlug: string | null) {
  const moved = removeNode(node.slug);
  if (!moved) return;
  moved.kind = kind;
  if (kind === "modal" && parentSlug && parentSlug !== node.slug) {
    const p = findNode(parentSlug);
    (p ? p.children : tree.value).push(moved);
  } else {
    tree.value.push(moved);
  }
  await saveTree();
}

// ── Acciones ──────────────────────────────────────────────────────────────────
// Pantallas materializadas que aún no tienen maqueta (se están "dibujando").
function pendingMockups(): number {
  return Object.values(status.value).filter((s) => s.hasScreen && !s.mockupExists).length;
}
// Sondea hasta que todas las maquetas se han poblado (las genera el servidor en 2º plano).
function startPoll() {
  clearInterval(pollTimer);
  let ticks = 0;
  pollTimer = setInterval(async () => {
    ticks++;
    await load();
    if (pendingMockups() === 0 || ticks > 40) { clearInterval(pollTimer); generatingAll.value = false; }
  }, 3000);
}

// "Generar mapa con IA": la IA crea el árbol + las pantallas (y sus maquetas en 2º plano).
async function defineAll() {
  if (defining.value) return;
  defining.value = true; error.value = null;
  try {
    await api.defineScreens(projectId.value);
    await load();
    if (pendingMockups() > 0) { generatingAll.value = true; startPoll(); }
  } catch (e: any) { error.value = `No se pudo generar el mapa: ${e?.message ?? e}`; }
  finally { defining.value = false; }
}

// "Generar todas las maquetas": crea las pantallas que falten y genera TODAS las maquetas pendientes.
async function generateAll() {
  if (generatingAll.value) return;
  generatingAll.value = true; error.value = null;
  try {
    await api.generateAllScreens(projectId.value);
    await load();
    if (pendingMockups() > 0) startPoll(); else generatingAll.value = false;
  } catch (e: any) {
    error.value = `No se pudieron generar las maquetas: ${e?.message ?? e}`;
    generatingAll.value = false;
  }
}

// ── Preview de la pantalla seleccionada ───────────────────────────────────────
const viewMode = ref<"maqueta" | "spec">("maqueta");
const mockupHtml = ref<string | null>(null);
const specContent = ref("");
const busy = ref(false);

watch(selectedSlug, async () => {
  viewMode.value = "maqueta";
  mockupHtml.value = null;
  specContent.value = "";
  modifyOpen.value = false;
  if (selectedSlug.value && selStatus.value?.hasScreen) await Promise.all([loadMockup(), loadSpec()]);
});

async function loadMockup() {
  if (!selPath.value) return;
  try { mockupHtml.value = (await api.getScreenMockup(projectId.value, selPath.value)).html; } catch { mockupHtml.value = null; }
}
async function loadSpec() {
  if (!selPath.value) return;
  try { specContent.value = (await api.getFileContent(projectId.value, selPath.value)).content ?? ""; } catch { specContent.value = ""; }
}
async function regenerate() {
  if (!selPath.value || busy.value) return;
  busy.value = true; error.value = null;
  try { mockupHtml.value = (await api.generateScreenMockup(projectId.value, selPath.value)).html; await load(); }
  catch (e: any) { error.value = e?.message ?? String(e); }
  finally { busy.value = false; }
}

// ── Modificar con IA (spec + maqueta) ─────────────────────────────────────────
const modifyOpen = ref(false);
const modifyText = ref("");
async function applyModify() {
  const text = modifyText.value.trim();
  if (!text || !selPath.value || busy.value) return;
  busy.value = true; error.value = null;
  try {
    const r = await api.modifyScreen(projectId.value, selPath.value, text);
    mockupHtml.value = r.html;
    if (r.spec != null) specContent.value = r.spec;
    modifyText.value = "";
    modifyOpen.value = false;
    await load();
  } catch (e: any) { error.value = `No se pudo modificar: ${e?.message ?? e}`; }
  finally { busy.value = false; }
}

onMounted(load);
onBeforeUnmount(() => clearInterval(pollTimer));
watch(projectId, () => { selectedSlug.value = null; load(); });
</script>

<template>
  <div class="screens-shell">
    <!-- Árbol del mapa -->
    <aside class="screens-tree">
      <div class="screens-tree-actions">
        <button class="btn-define" :disabled="defining" @click="defineAll">
          <Loader2 v-if="defining" class="spin" :size="14" :stroke-width="2" />
          <Sparkles v-else :size="14" :stroke-width="2" />
          {{ defining ? "Generando…" : "Generar mapa con IA" }}
        </button>
        <button class="btn-mat" :disabled="generatingAll || tree.length === 0" title="Crea las pantallas que falten y dibuja todas las maquetas pendientes" @click="generateAll">
          <Loader2 v-if="generatingAll" class="spin" :size="13" :stroke-width="2" />
          <Images v-else :size="13" :stroke-width="2" />
          {{ generatingAll ? "Generando…" : "Generar todas las maquetas" }}
        </button>
      </div>
      <div class="screens-tree-head">
        <span>Mapa de pantallas</span>
        <div style="display:flex; gap:6px">
          <button class="tree-icon-btn" title="Nueva pantalla" @click="startAdd('pagina')"><Plus :size="13" :stroke-width="2.5" /></button>
          <button class="tree-icon-btn" title="Nuevo modal" :disabled="pages.length === 0" @click="startAdd('modal')"><AppWindow :size="13" :stroke-width="2" /></button>
        </div>
      </div>

      <div v-if="addMode" class="add-form">
        <input v-model="addName" class="add-input" :placeholder="addMode === 'modal' ? 'Nombre del modal…' : 'Nombre de la pantalla…'" @keydown.enter="confirmAdd" @keydown.escape="addMode = null" autofocus />
        <select v-if="addMode === 'modal'" v-model="addParent" class="add-select">
          <option v-for="p in pages" :key="p.slug" :value="p.slug">modal de: {{ p.name }}</option>
        </select>
        <div class="add-actions">
          <button class="btn-mini primary" :disabled="!addName.trim()" @click="confirmAdd">Añadir al mapa</button>
          <button class="btn-mini" @click="addMode = null">Cancelar</button>
        </div>
      </div>

      <div v-if="loading" class="tree-empty">Cargando…</div>
      <div v-else-if="tree.length === 0" class="tree-empty">
        <p>El mapa está vacío.</p>
        <p>Pulsa <strong>Generar mapa con IA</strong> y se dibujará el árbol de pantallas a partir de tu negocio.</p>
      </div>

      <div v-else class="tree-list">
        <div
          v-for="n in flatTree" :key="n.slug"
          class="tree-row" :class="{ selected: n.slug === selectedSlug, modal: n.kind === 'modal' }"
          :style="{ paddingLeft: 8 + n.depth * 16 + 'px' }"
          @click="selectedSlug = n.slug"
        >
          <component :is="n.kind === 'modal' ? AppWindow : Monitor" :size="15" :stroke-width="1.9" class="tree-row-ico" />
          <span class="tree-row-name">{{ n.name }}</span>
          <span v-if="n.kind === 'modal'" class="tree-row-tag">modal</span>
          <span
            class="tree-dot"
            :class="!status[n.slug]?.hasScreen ? 'pending' : (status[n.slug]?.mockupExists ? (status[n.slug]?.stale ? 'stale' : 'ok') : 'nomock')"
            :title="!status[n.slug]?.hasScreen ? 'pendiente de materializar' : (status[n.slug]?.mockupExists ? (status[n.slug]?.stale ? 'maqueta desactualizada' : 'con maqueta') : 'materializada, sin maqueta')"
          />
        </div>
      </div>
    </aside>

    <!-- Detalle -->
    <div class="screens-detail">
      <div v-if="error" class="screens-error">⚠ {{ error }}</div>

      <template v-if="selected">
        <!-- Nodo aún no materializado -->
        <template v-if="!selStatus?.hasScreen">
          <div class="detail-empty">
            <ImageOff :size="40" :stroke-width="1.3" style="opacity:.3" />
            <h3>{{ selected.name }}</h3>
            <p class="muted">Está en el mapa pero su maqueta aún no se ha dibujado. Genera todas de una vez.</p>
            <button class="btn-soft accent" :disabled="generatingAll" @click="generateAll"><Images :size="14" :stroke-width="2" /> Generar todas las maquetas</button>
          </div>
        </template>

        <!-- Pantalla materializada -->
        <template v-else>
          <div class="detail-toolbar">
            <span class="detail-name">{{ selected.name }}</span>
            <span class="detail-tag">{{ selected.kind === 'modal' ? 'modal' : 'página' }}</span>
            <span class="detail-tag plantilla">plantilla del constructor</span>
            <span class="detail-spacer" />
            <span class="view-toggle">
              <button :class="{ active: viewMode === 'maqueta' }" @click="viewMode = 'maqueta'">Maqueta</button>
              <button :class="{ active: viewMode === 'spec' }" @click="viewMode = 'spec'">Spec</button>
            </span>
            <button class="btn-soft accent" :class="{ on: modifyOpen }" :disabled="busy || !selStatus?.mockupExists" @click="modifyOpen = !modifyOpen"><Wand2 :size="14" :stroke-width="2" /> Modificar con IA</button>
            <button class="btn-soft" :disabled="busy" @click="regenerate"><RefreshCw :size="14" :stroke-width="2" :class="{ spin: busy }" /> {{ selStatus?.mockupExists ? 'Regenerar' : 'Generar' }}</button>
            <button class="btn-soft danger" :disabled="busy" @click="removeSelected(selected)"><Trash2 :size="14" :stroke-width="2" /></button>
          </div>

          <div class="hierarchy-bar">
            <ArrowRightLeft :size="13" :stroke-width="2" />
            <label>En el mapa:</label>
            <select :value="selected.kind" @change="setHierarchy(selected!, ($event.target as HTMLSelectElement).value as any, selected!.kind === 'modal' ? findNodeParent(selected!.slug) : null)">
              <option value="pagina">Página</option>
              <option value="modal">Modal</option>
            </select>
            <template v-if="selected.kind === 'modal'">
              <label>de:</label>
              <select :value="findNodeParent(selected.slug) ?? ''" @change="setHierarchy(selected!, 'modal', ($event.target as HTMLSelectElement).value || null)">
                <option v-for="p in pages.filter(p => p.slug !== selected!.slug)" :key="p.slug" :value="p.slug">{{ p.name }}</option>
              </select>
            </template>
          </div>

          <div v-if="modifyOpen" class="modify-bar">
            <Wand2 :size="15" :stroke-width="2" class="modify-ico" />
            <input v-model="modifyText" class="modify-input" placeholder="Dile qué cambiar: añade una columna 'Próxima cita' y un filtro por estado…" :disabled="busy" @keydown.enter="applyModify" @keydown.escape="modifyOpen = false" autofocus />
            <button class="btn-mini primary" :disabled="busy || !modifyText.trim()" @click="applyModify">{{ busy ? 'Aplicando…' : 'Aplicar' }}</button>
            <button class="btn-mini" @click="modifyOpen = false">Cancelar</button>
          </div>

          <div class="detail-body">
            <template v-if="viewMode === 'maqueta'">
              <div v-if="busy" class="detail-state"><Loader2 class="spin" :size="22" :stroke-width="2" /> Generando…</div>
              <iframe v-else-if="selStatus?.mockupExists" class="screen-frame" sandbox="" :srcdoc="mockupHtml ?? ''" />
              <div v-else class="detail-state">
                <ImageOff :size="34" :stroke-width="1.3" style="opacity:.3" />
                <p>Esta pantalla aún no tiene maqueta.</p>
                <button class="btn-soft accent" :disabled="busy" @click="regenerate"><Sparkles :size="14" :stroke-width="2" /> Generar maqueta</button>
              </div>
            </template>
            <div v-else class="spec-view markdown" v-html="renderMarkdown(specContent)" />
          </div>

          <div class="sync-note">
            <ArrowRightLeft :size="15" :stroke-width="2" />
            <span>El constructor reproduce esta pantalla <strong>fielmente</strong>. Si el código exige un cambio, la maqueta se actualiza <strong>en paralelo</strong> — reflejo fiel de lo que saldrá.</span>
          </div>
        </template>
      </template>

      <div v-else class="detail-empty">
        <FileText :size="46" :stroke-width="1.2" style="opacity:.2" />
        <h3>El mapa manda</h3>
        <p class="muted">A la izquierda está el árbol de pantallas de tu app (la fuente de la estructura). Elige una para verla y ajustarla, o deja que la IA genere el mapa completo.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screens-shell { display: flex; flex: 1; overflow: hidden; height: 100%; }

.screens-tree { width: 248px; flex-shrink: 0; background: var(--bg-surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
.screens-tree-actions { padding: 10px; border-bottom: 1px solid var(--border-dim); display: flex; flex-direction: column; gap: 6px; }
.btn-define {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  background: var(--accent); color: #fff; border: none; border-radius: var(--r); padding: 9px 12px;
  font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.btn-define:disabled { opacity: .7; cursor: default; }
.btn-mat {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: transparent; color: var(--text-muted); border: 1px solid var(--border); border-radius: var(--r);
  padding: 6px 12px; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.btn-mat:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.btn-mat:disabled { opacity: .5; cursor: default; }
.screens-tree-head {
  display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--text-dim);
}
.tree-icon-btn { display: inline-flex; background: transparent; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-muted); cursor: pointer; padding: 3px 6px; }
.tree-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.tree-icon-btn:disabled { opacity: .4; cursor: default; }

.add-form { padding: 8px 10px; border-bottom: 1px solid var(--border-dim); display: flex; flex-direction: column; gap: 6px; background: var(--bg); }
.add-input, .add-select { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text); outline: none; }
.add-input:focus { border-color: var(--accent); }
.add-actions { display: flex; gap: 6px; }

.tree-empty { padding: 18px 14px; font-size: 12.5px; color: var(--text-muted); line-height: 1.6; text-align: center; }
.tree-empty p + p { margin-top: 6px; }
.tree-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.tree-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; }
.tree-row:hover { background: var(--bg-hover); }
.tree-row.selected { background: var(--accent-bg); color: var(--accent); }
.tree-row.modal { color: var(--text-muted); }
.tree-row.selected.modal { color: var(--accent); }
.tree-row-ico { flex-shrink: 0; }
.tree-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.tree-row-tag { font-size: 10px; color: var(--text-dim); }
.tree-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.tree-dot.ok { background: var(--green); }
.tree-dot.stale { background: var(--amber, #d9920a); }
.tree-dot.nomock { background: var(--amber, #d9920a); opacity: .5; }
.tree-dot.pending { background: var(--border); }

.screens-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
.screens-error { margin: 10px 16px 0; padding: 9px 12px; border-radius: var(--r); font-size: 13px; color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
.detail-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-surface); flex-wrap: wrap; }
.detail-name { font-size: 15px; font-weight: 700; color: var(--text); text-transform: capitalize; }
.detail-tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--bg-elevated, var(--bg)); color: var(--text-muted); }
.detail-tag.plantilla { background: var(--accent-bg); color: var(--accent); }
.detail-spacer { flex: 1; }
.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
.view-toggle button { border: none; background: transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight: 600; padding: 4px 12px; cursor: pointer; }
.view-toggle button + button { border-left: 1px solid var(--border); }
.view-toggle button.active { background: var(--accent-bg); color: var(--accent); }

.btn-soft { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-muted); font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer; }
.btn-soft:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.btn-soft:disabled { opacity: .5; cursor: default; }
.btn-soft.accent { color: var(--accent); border-color: var(--accent-border); }
.btn-soft.accent.on { background: var(--accent-bg); }
.btn-soft.danger { color: var(--red); }

.hierarchy-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--border-dim); font-size: 12.5px; color: var(--text-muted); }
.hierarchy-bar select { font: inherit; font-size: 12.5px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text); }

.modify-bar { display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-bottom: 1px solid var(--border-dim); background: var(--accent-bg); }
.modify-ico { color: var(--accent); flex-shrink: 0; }
.modify-input { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; padding: 7px 10px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--bg); color: var(--text); outline: none; }

.detail-body { flex: 1; overflow: auto; position: relative; background: var(--bg); display: flex; }
.screen-frame { flex: 1; border: none; background: #fff; }
.detail-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); font-size: 14px; text-align: center; }
.spec-view { padding: 24px 30px; max-width: 760px; }

.sync-note { display: flex; align-items: flex-start; gap: 9px; padding: 10px 16px; border-top: 1px solid var(--border-dim); font-size: 12.5px; color: var(--text-muted); line-height: 1.5; background: var(--bg-surface); }
.sync-note svg { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
.sync-note strong { color: var(--text); font-weight: 600; }

.detail-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 60px 24px; }
.detail-empty h3 { font-size: 16px; color: var(--text); margin: 0; text-transform: capitalize; }
.detail-empty p { font-size: 14px; max-width: 420px; line-height: 1.6; }

.btn-mini { background: transparent; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-muted); font: inherit; font-size: 12px; padding: 5px 11px; cursor: pointer; }
.btn-mini:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.btn-mini.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-mini:disabled { opacity: .6; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
