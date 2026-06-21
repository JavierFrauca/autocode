<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { useDialog } from "../composables/useDialog";
import { Upload, Trash2, Copy, CheckCheck, ImageOff, Loader, RotateCcw } from "lucide-vue-next";

const route     = useRoute();
const dialog    = useDialog();
const projectId = computed(() => route.params.projectId as string);

interface MediaFile { name: string; size: number; url: string; projectPath: string }

const files       = ref<MediaFile[]>([]);
const loading     = ref(false);
const uploading   = ref(false);
const uploadError = ref<string | null>(null);
const dragging    = ref(false);
const copiedPath  = ref<string | null>(null);
const fileInput   = ref<HTMLInputElement | null>(null);
const preview     = ref<MediaFile | null>(null);

async function load() {
  loading.value = true;
  try { files.value = (await api.listMedia(projectId.value)).files; }
  catch { files.value = []; }
  finally { loading.value = false; }
}

async function uploadFiles(list: FileList | File[]) {
  const allowed = ["image/png","image/jpeg","image/gif","image/webp","image/svg+xml","image/avif","image/x-icon"];
  uploading.value = true;
  uploadError.value = null;
  for (const file of Array.from(list)) {
    if (!allowed.includes(file.type)) { uploadError.value = `Tipo no permitido: ${file.name}`; continue; }
    const r = await api.uploadMedia(projectId.value, file);
    if (!r.ok) { uploadError.value = r.error ?? "Error al subir"; }
  }
  uploading.value = false;
  await load();
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) uploadFiles(input.files);
  input.value = "";
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files?.length) uploadFiles(files);
}

async function deleteFile(f: MediaFile) {
  const ok = await dialog.danger("Borrar imagen", `¿Eliminar "${f.name}"?`, { confirmLabel: "Sí, borrar" });
  if (!ok) return;
  await api.deleteMedia(projectId.value, f.name);
  if (preview.value?.name === f.name) preview.value = null;
  await load();
}

async function copyPath(f: MediaFile) {
  await navigator.clipboard.writeText(f.projectPath);
  copiedPath.value = f.name;
  setTimeout(() => { if (copiedPath.value === f.name) copiedPath.value = null; }, 2000);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fullUrl(f: MediaFile) {
  return api.mediaUrl(projectId.value, f.name);
}

onMounted(load);
watch(projectId, load);
</script>

<template>
  <div class="media-shell">
    <!-- Sidebar info -->
    <aside class="media-sidebar">
      <div class="media-sidebar-title">
        Recursos multimedia
        <button class="media-reload-btn" title="Recargar" @click="load">
          <RotateCcw :size="12" :stroke-width="2.5" />
        </button>
      </div>
      <p class="media-sidebar-hint">
        Sube logos, fondos o cualquier imagen. El asistente las conoce y las usará automáticamente
        al generar el código de tu aplicación.
      </p>
      <div class="media-sidebar-hint" style="margin-top:8px; font-size:11px; color:var(--text-dim)">
        Formatos: PNG, JPG, GIF, WebP, SVG, AVIF · Máx 20 MB por archivo
      </div>
      <div class="media-count">
        {{ files.length }} {{ files.length === 1 ? 'archivo' : 'archivos' }}
      </div>
    </aside>

    <!-- Área principal -->
    <div class="media-main">

      <!-- Zona de subida -->
      <div
        class="drop-zone"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop="onDrop"
        @click="fileInput?.click()"
      >
        <input ref="fileInput" type="file" multiple accept="image/*" style="display:none" @change="onFileInput" />
        <Loader v-if="uploading" :size="28" :stroke-width="1.6" class="drop-spin" />
        <Upload v-else :size="28" :stroke-width="1.6" class="drop-icon" />
        <div class="drop-label">
          {{ uploading ? 'Subiendo…' : dragging ? 'Suelta aquí' : 'Arrastra imágenes o haz clic para elegir' }}
        </div>
      </div>

      <div v-if="uploadError" class="upload-error">⚠ {{ uploadError }}</div>

      <!-- Loading -->
      <div v-if="loading" class="media-loading">
        <Loader :size="20" :stroke-width="2" class="drop-spin" />
        Cargando recursos…
      </div>

      <!-- Galería -->
      <div v-else-if="files.length" class="media-grid">
        <div
          v-for="f in files"
          :key="f.name"
          class="media-card"
          :class="{ active: preview?.name === f.name }"
          @click="preview = preview?.name === f.name ? null : f"
        >
          <div class="media-thumb-wrap">
            <img :src="fullUrl(f)" :alt="f.name" class="media-thumb" loading="lazy" />
          </div>
          <div class="media-card-info">
            <span class="media-card-name" :title="f.name">{{ f.name }}</span>
            <span class="media-card-size">{{ formatSize(f.size) }}</span>
          </div>
          <div class="media-card-actions">
            <button
              class="media-action-btn"
              :title="copiedPath === f.name ? 'Copiado' : 'Copiar ruta'"
              @click.stop="copyPath(f)"
            >
              <CheckCheck v-if="copiedPath === f.name" :size="13" :stroke-width="2.5" style="color:var(--green)" />
              <Copy v-else :size="13" :stroke-width="2" />
            </button>
            <button class="media-action-btn delete" title="Borrar" @click.stop="deleteFile(f)">
              <Trash2 :size="13" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>

      <!-- Vacío -->
      <div v-else-if="!loading" class="media-empty">
        <ImageOff :size="44" :stroke-width="1.3" />
        <h3>Aún no hay recursos</h3>
        <p class="muted">Sube logos, fondos o iconos y el asistente los incluirá en tu aplicación.</p>
      </div>

      <!-- Preview lateral -->
      <div v-if="preview" class="media-preview">
        <div class="media-preview-header">
          <span class="media-preview-name">{{ preview.name }}</span>
          <button class="media-action-btn" @click="preview = null" title="Cerrar">✕</button>
        </div>
        <img :src="fullUrl(preview)" :alt="preview.name" class="media-preview-img" />
        <div class="media-preview-meta">
          <div class="meta-row"><span>Tamaño</span><strong>{{ formatSize(preview.size) }}</strong></div>
          <div class="meta-row"><span>Ruta en el proyecto</span><code>{{ preview.projectPath }}</code></div>
        </div>
        <button class="btn primary" style="width:100%; margin-top:12px; gap:7px" @click="copyPath(preview)">
          <CheckCheck v-if="copiedPath === preview.name" :size="14" /> <Copy v-else :size="14" />
          {{ copiedPath === preview.name ? '¡Copiado!' : 'Copiar ruta' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.media-shell {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Sidebar ── */
.media-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.media-sidebar-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border-dim);
  padding-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.media-reload-btn {
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 2px 4px;
  border-radius: var(--r-sm);
  transition: color .12s, background .12s;
}
.media-reload-btn:hover { color: var(--text); background: var(--bg-hover); }
.media-sidebar-hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
.media-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  margin-top: auto;
}

/* ── Área principal ── */
.media-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 22px;
  gap: 16px;
  position: relative;
  overflow-y: auto;
}

/* ── Drop zone ── */
.drop-zone {
  border: 2px dashed var(--border);
  border-radius: var(--r-lg);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
  flex-shrink: 0;
  text-align: center;
}
.drop-zone:hover, .drop-zone.dragging {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.drop-icon  { color: var(--text-dim); transition: color .15s; }
.drop-zone:hover .drop-icon, .drop-zone.dragging .drop-icon { color: var(--accent); }
.drop-label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
.drop-spin  { color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.upload-error {
  font-size: 12px;
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 25%, transparent);
  border-radius: var(--r);
  padding: 8px 12px;
  flex-shrink: 0;
}

/* ── Loading ── */
.media-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-dim);
  padding: 16px 0;
}

/* ── Galería ── */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.media-card {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
  display: flex;
  flex-direction: column;
}
.media-card:hover  { border-color: var(--accent-border); box-shadow: var(--shadow-sm); }
.media-card.active { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }

.media-thumb-wrap {
  aspect-ratio: 1;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.media-thumb {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 8px;
}
.media-card-info {
  padding: 7px 9px 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.media-card-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-card-size { font-size: 10.5px; color: var(--text-dim); }

.media-card-actions {
  display: flex;
  gap: 4px;
  padding: 4px 7px 7px;
}
.media-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-dim);
  border-radius: var(--r-sm);
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 6px;
  transition: background .12s, color .12s, border-color .12s;
  font-size: 12px;
}
.media-action-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border); }
.media-action-btn.delete:hover { background: color-mix(in srgb, var(--red) 10%, transparent); color: var(--red); border-color: var(--red); }

/* ── Empty ── */
.media-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  flex: 1;
  gap: 10px;
  color: var(--text-dim);
  padding: 40px 0;
}
.media-empty h3 { font-size: 16px; color: var(--text); margin: 0; }
.media-empty p  { font-size: 14px; max-width: 360px; line-height: 1.6; }

/* ── Preview ── */
.media-preview {
  position: absolute;
  right: 22px;
  top: 20px;
  width: 260px;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10;
}
.media-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.media-preview-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-preview-img {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: var(--r);
  background: var(--bg);
  padding: 8px;
}
.media-preview-meta { display: flex; flex-direction: column; gap: 6px; }
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.meta-row span { color: var(--text-dim); }
.meta-row strong { color: var(--text); }
.meta-row code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--bg);
  padding: 2px 6px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-dim);
  color: var(--accent);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
