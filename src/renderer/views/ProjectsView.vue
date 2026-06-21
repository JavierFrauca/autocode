<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores";
import { api, timeAgo } from "../api";
import { useDialog } from "../composables/useDialog";
import { FileText, Search, X as XIcon } from "lucide-vue-next";

const app = useAppStore();
const router = useRouter();
const dialog = useDialog();

const search = ref("");
const showCreate = ref(false);
const name = ref("");
const description = ref("");
const creating = ref(false);
const error = ref<string | null>(null);

onMounted(() => app.refreshProjects());

async function create() {
  if (!name.value.trim()) return;
  creating.value = true;
  error.value = null;
  try {
    const p = await api.createProject(name.value.trim(), description.value.trim() || undefined);
    await app.refreshProjects();
    name.value = "";
    description.value = "";
    showCreate.value = false;
    router.push(`/projects/${p.id}/chat`);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    creating.value = false;
  }
}

function open(id: string) {
  router.push(`/projects/${id}/chat`);
}

async function remove(p: any, ev: Event) {
  ev.stopPropagation();
  ev.preventDefault();
  const ok = await dialog.danger(
    `Borrar "${p.name}"`,
    `El proyecto dejará de aparecer en la lista.\n\nLa carpeta en disco (${p.rootPath}) NO se borra — la conservas tú.`,
    { confirmLabel: "Sí, borrar" },
  );
  if (!ok) return;
  try {
    await api.deleteProject(p.id);
    await app.refreshProjects();
  } catch (e: any) {
    await dialog.alert("Error al borrar", e?.message ?? String(e));
  }
}

const PALETTE = [
  "#5B4CF5", "#9C27B0", "#FF9800", "#059669",
  "#DC2626", "#D97706", "#3B82F6", "#EC4899",
  "#10B981", "#8B5CF6", "#F59E0B", "#06B6D4",
];

function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function colorFor(n: string) { return PALETTE[hashName(n) % PALETTE.length]!; }
function monogram(n: string): string {
  const parts = n.trim().split(/\s+/);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// Estado de la tarjeta: el backend lo deriva de las ejecuciones reales (ver projects.ts).
// "built" = hay app compilada en verde → barra al 100% en verde.
const STATUS_UI: Record<string, { label: string; fill: number; tone: string }> = {
  empty:       { label: "Sin documentos aún", fill: 0,   tone: "" },
  defining:    { label: "En definición",      fill: 30,  tone: "" },
  generating:  { label: "Generando…",         fill: 65,  tone: "run" },
  checking:    { label: "Comprobando…",        fill: 85,  tone: "run" },
  built:       { label: "Generada ✓",          fill: 100, tone: "ok" },
  needs_input: { label: "Necesita tu ayuda",   fill: 80,  tone: "warn" },
  failed:      { label: "Falló — revísala",    fill: 60,  tone: "bad" },
};

function ui(p: any) {
  const key = p.status ?? ((p.documentsCount ?? 0) > 0 ? "defining" : "empty");
  return STATUS_UI[key] ?? STATUS_UI.empty!;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  let list = app.projects.slice();
  if (q) list = list.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q),
  );
  return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
});
</script>

<template>
  <div class="projects-shell">
    <!-- Header -->
    <div class="projects-header">
      <div>
        <h1>Mis proyectos</h1>
        <p class="muted" style="font-size:13px; margin-top:2px">
          {{ app.projects.length }} {{ app.projects.length === 1 ? "proyecto" : "proyectos" }}
        </p>
      </div>
      <div class="spacer" />
      <input
        v-if="app.projects.length > 0"
        v-model="search"
        class="projects-search"
        placeholder="Buscar…"
      />
      <button class="btn primary" @click="showCreate = !showCreate">
        + Nuevo proyecto
      </button>
    </div>

    <!-- Inline create -->
    <div v-if="showCreate" class="create-panel">
      <div class="create-panel-title">Nuevo proyecto</div>
      <div class="create-fields">
        <div class="field" style="flex:1; margin:0">
          <label class="field-label">Nombre del proyecto</label>
          <input v-model="name" placeholder="Ej: Tienda Online" @keydown.enter="create" autofocus />
        </div>
        <div class="field" style="flex:2; margin:0">
          <label class="field-label">Descripción breve <span class="muted" style="font-weight:400">(opcional)</span></label>
          <input v-model="description" placeholder="Una línea sobre qué quieres construir" @keydown.enter="create" />
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" @click="create" :disabled="creating || !name.trim()">
          {{ creating ? "Creando…" : "Crear y abrir" }}
        </button>
        <button class="btn ghost" @click="showCreate = false; name = ''; description = ''">Cancelar</button>
        <span v-if="error" class="badge bad">{{ error }}</span>
      </div>
    </div>

    <!-- Empty state simplificado -->
    <div v-if="app.projects.length === 0 && !showCreate" class="empty-state">
      <p class="muted" style="font-size:14px">Aún no tienes proyectos.</p>
      <button class="btn primary" style="margin-top:12px" @click="showCreate = true">
        + Crear mi primer proyecto
      </button>
    </div>

    <!-- Sin resultados de búsqueda -->
    <div v-else-if="filtered.length === 0 && search" class="empty">
      <div class="empty-icon"><Search :size="48" :stroke-width="1.3" /></div>
      <p class="muted">Ningún proyecto coincide con "{{ search }}"</p>
    </div>

    <!-- Grid de proyectos -->
    <div v-else class="projects-grid">
      <a
        v-for="p in filtered"
        :key="p.id"
        class="proj-card"
        :href="`#/projects/${p.id}/chat`"
        @click.prevent="open(p.id)"
      >
        <button class="proj-delete" title="Borrar proyecto" @click="remove(p, $event)"><XIcon :size="12" :stroke-width="2.5" /></button>

        <div class="proj-head">
          <div class="proj-avatar" :style="{ background: colorFor(p.name) }">{{ monogram(p.name) }}</div>
          <div class="proj-meta">
            <strong class="proj-name">{{ p.name }}</strong>
            <span class="proj-time">{{ timeAgo(p.createdAt) }}</span>
          </div>
        </div>

        <p class="proj-desc">{{ p.description || "Sin descripción" }}</p>

        <div class="proj-progress">
          <div class="progress-bar">
            <div class="progress-fill" :class="ui(p).tone" :style="{ width: ui(p).fill + '%' }" />
          </div>
          <span class="proj-progress-label" :class="ui(p).tone">{{ ui(p).label }}</span>
        </div>

        <div class="proj-foot">
          <span class="badge info" style="display:inline-flex;align-items:center;gap:4px"><FileText :size="11" :stroke-width="2" /> {{ p.documentsCount ?? 0 }} doc{{ (p.documentsCount ?? 0) !== 1 ? 's' : '' }}</span>
        </div>
      </a>

      <!-- Card nueva -->
      <div class="proj-card proj-card-new" @click="showCreate = true">
        <div class="new-plus">+</div>
        <div class="new-label">Nuevo proyecto</div>
        <div class="new-hint">Cuéntanos qué quieres construir</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.projects-shell {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
  background: var(--bg);
}

.projects-header {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.projects-search {
  width: 260px;
  max-width: 35vw;
}

/* Create panel */
.create-panel {
  background: var(--bg-surface);
  border: 1.5px solid var(--accent-border);
  border-radius: var(--r-lg);
  padding: 20px 22px;
  margin-bottom: 20px;
  box-shadow: var(--shadow);
}
.create-panel-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 14px;
}
.create-fields {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.create-fields .field { min-width: 180px; }

/* Empty search */
.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; }
.empty-icon { color: var(--text-dim); }

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 24px;
  gap: 4px;
  text-align: center;
}

/* Grid */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 14px;
}

/* Project card */
.proj-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 18px;
  color: var(--text);
  text-decoration: none;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .15s;
  position: relative;
  min-height: 170px;
  box-shadow: var(--shadow-sm);
}
.proj-card:hover {
  border-color: var(--accent-border);
  box-shadow: var(--shadow);
  transform: translateY(-2px);
  text-decoration: none;
}
.proj-card:active { transform: translateY(0); }

.proj-delete {
  position: absolute;
  top: 10px; right: 10px;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s, color .12s, background .12s;
}
.proj-card:hover .proj-delete { opacity: 1; }
.proj-delete:hover { color: var(--red); border-color: var(--red-border); background: var(--red-bg); }

.proj-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.proj-avatar {
  width: 40px; height: 40px;
  border-radius: var(--r);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 15px; color: white;
  flex-shrink: 0;
}
.proj-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.proj-name {
  font-size: 14px; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.proj-time { font-size: 12px; color: var(--text-muted); }

.proj-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  flex: 1;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.proj-progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}
.proj-progress-label { font-size: 11px; color: var(--text-dim); font-weight: 500; }

/* Color de la barra y la etiqueta según el estado real del proyecto */
.progress-fill.ok   { background: var(--green); }
.progress-fill.run  { background: var(--accent); }
.progress-fill.warn { background: var(--yellow); }
.progress-fill.bad  { background: var(--red); }
.proj-progress-label.ok   { color: var(--green); font-weight: 600; }
.proj-progress-label.warn { color: var(--yellow); }
.proj-progress-label.bad  { color: var(--red); }

.proj-foot { display: flex; align-items: center; gap: 6px; }

/* New card */
.proj-card-new {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  background: transparent;
  color: var(--text-muted);
  min-height: 170px;
  text-decoration: none;
}
.proj-card-new:hover { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }
.new-plus  { font-size: 28px; font-weight: 300; color: var(--text-dim); }
.new-label { font-size: 14px; font-weight: 600; }
.new-hint  { font-size: 12px; color: var(--text-dim); }
.proj-card-new:hover .new-plus { color: var(--accent); }
</style>
