<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { Sparkles, Wand2, Eye, Loader2, ImageOff, X } from "lucide-vue-next";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: "open", path: string): void }>();

interface Screen { path: string; name: string; mockupExists: boolean; stale: boolean; html: string | null }

const screens = ref<Screen[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

// Estado por pantalla (clave = path): cuáles están generándose y cuál tiene abierto el "modificar con IA".
const busy = ref<Set<string>>(new Set());
const modifyFor = ref<string | null>(null);
const modifyText = ref("");
const generatingAll = ref(false);

function setBusy(path: string, on: boolean) {
  const s = new Set(busy.value);
  if (on) s.add(path); else s.delete(path);
  busy.value = s;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.listScreens(props.projectId);
    screens.value = r.screens;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

function patch(path: string, html: string | null) {
  const i = screens.value.findIndex((s) => s.path === path);
  if (i >= 0) screens.value[i] = { ...screens.value[i], html, mockupExists: !!html, stale: false };
}

// Generar / regenerar una pantalla. Devuelve cuando termina (para encadenar la generación "viva").
async function generateOne(path: string, instruction?: string) {
  setBusy(path, true);
  try {
    // Con instrucción ("modificar con IA") editamos spec + maqueta de forma coherente; sin ella, generamos.
    const r = instruction
      ? await api.modifyScreen(props.projectId, path, instruction)
      : await api.generateScreenMockup(props.projectId, path);
    patch(path, r.html);
  } catch (e: any) {
    error.value = `No se pudo generar «${path.split("/").pop()}»: ${e?.message ?? e}`;
  } finally {
    setBusy(path, false);
  }
}

// Generar las que faltan, UNA A UNA, para verlas aparecer sobre la marcha.
async function generateMissing() {
  if (generatingAll.value) return;
  generatingAll.value = true;
  error.value = null;
  try {
    for (const s of screens.value.filter((x) => !x.mockupExists)) {
      await generateOne(s.path);
    }
  } finally {
    generatingAll.value = false;
  }
}

function openModify(path: string) {
  modifyFor.value = path;
  modifyText.value = "";
}
async function submitModify(path: string) {
  const text = modifyText.value.trim();
  if (!text) return;
  modifyFor.value = null;
  await generateOne(path, text);
}
</script>

<template>
  <div class="gallery">
    <div class="gallery-head">
      <div class="gallery-title">
        <Sparkles :size="18" :stroke-width="2" />
        <h2>Galería de pantallas</h2>
        <span class="gallery-sub">Así se verán. Son bocetos: ajústalos con la IA antes de construir.</span>
      </div>
      <div class="gallery-head-actions">
        <button v-if="screens.some((s) => !s.mockupExists)" class="btn primary" style="gap:7px" :disabled="generatingAll" @click="generateMissing">
          <Loader2 v-if="generatingAll" class="spin" :size="15" :stroke-width="2" />
          <Sparkles v-else :size="15" :stroke-width="2" />
          {{ generatingAll ? "Generando…" : `Generar las que faltan (${screens.filter((s) => !s.mockupExists).length})` }}
        </button>
      </div>
    </div>

    <div v-if="error" class="gallery-error">⚠ {{ error }}</div>

    <div v-if="loading" class="gallery-state">Cargando pantallas…</div>
    <div v-else-if="screens.length === 0" class="gallery-state">
      <ImageOff :size="40" :stroke-width="1.3" style="opacity:.3" />
      <p>Aún no hay pantallas. Habla con la IA en el chat y las irá creando; aparecerán aquí.</p>
    </div>

    <div v-else class="gallery-grid">
      <div v-for="s in screens" :key="s.path" class="screen-card">
        <!-- Miniatura: el boceto real a escala, en iframe aislado (HTML no confiable) -->
        <div class="thumb" @click="s.mockupExists && emit('open', s.path)">
          <iframe v-if="s.mockupExists" class="thumb-frame" sandbox="" :srcdoc="s.html ?? ''" tabindex="-1" />
          <div v-else-if="busy.has(s.path)" class="thumb-empty">
            <Loader2 class="spin" :size="22" :stroke-width="2" /> Generando…
          </div>
          <div v-else class="thumb-empty">
            <ImageOff :size="22" :stroke-width="1.5" /> Sin maqueta
          </div>
          <span v-if="busy.has(s.path) && s.mockupExists" class="thumb-overlay">
            <Loader2 class="spin" :size="18" :stroke-width="2" /> Actualizando…
          </span>
          <span v-if="s.stale && s.mockupExists" class="thumb-stale" title="El spec cambió desde que se generó">desactualizada</span>
        </div>

        <div class="screen-meta">
          <span class="screen-name">{{ s.name }}</span>
        </div>

        <!-- Modificar con IA: el usuario dice qué cambiar y se aplica sobre el boceto actual -->
        <div v-if="modifyFor === s.path" class="modify-box">
          <input
            v-model="modifyText"
            class="modify-input"
            placeholder="Ej: sube el botón Guardar arriba · quita la columna de fecha · más espacio entre tarjetas…"
            @keydown.enter="submitModify(s.path)"
            @keydown.escape="modifyFor = null"
            autofocus
          />
          <div class="modify-actions">
            <button class="btn primary" style="font-size:12px; padding:5px 12px; gap:5px" :disabled="!modifyText.trim()" @click="submitModify(s.path)">
              <Wand2 :size="13" :stroke-width="2" /> Aplicar
            </button>
            <button class="btn ghost" style="font-size:12px; padding:5px 10px" @click="modifyFor = null">Cancelar</button>
          </div>
        </div>
        <div v-else class="screen-actions">
          <button class="btn ghost" style="font-size:12px; gap:5px" :disabled="!s.mockupExists" @click="emit('open', s.path)">
            <Eye :size="13" :stroke-width="2" /> Ver
          </button>
          <button v-if="s.mockupExists" class="btn ghost" style="font-size:12px; gap:5px" :disabled="busy.has(s.path)" @click="openModify(s.path)">
            <Wand2 :size="13" :stroke-width="2" /> Modificar con IA
          </button>
          <button v-else class="btn ghost" style="font-size:12px; gap:5px" :disabled="busy.has(s.path)" @click="generateOne(s.path)">
            <Sparkles :size="13" :stroke-width="2" /> Generar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery { flex: 1; overflow-y: auto; padding: 20px 24px; }
.gallery-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.gallery-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.gallery-title svg { color: var(--accent); }
.gallery-title h2 { margin: 0; font-size: 18px; color: var(--text); }
.gallery-sub { font-size: 12.5px; color: var(--text-muted); flex-basis: 100%; }
.gallery-error { margin-bottom: 12px; padding: 9px 12px; border-radius: var(--r); font-size: 13px; color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
.gallery-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding: 60px 20px; color: var(--text-muted); font-size: 14px; text-align: center;
}
.gallery-state p { max-width: 380px; line-height: 1.6; margin: 0; }

.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }

.screen-card {
  border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-surface);
  overflow: hidden; display: flex; flex-direction: column;
  box-shadow: var(--shadow-sm); transition: border-color .12s, box-shadow .12s;
}
.screen-card:hover { border-color: var(--accent-border); }

/* Miniatura: el boceto real a escala (1000×700 → escala según ancho). */
.thumb {
  position: relative; height: 168px; overflow: hidden; cursor: pointer;
  background: var(--bg); border-bottom: 1px solid var(--border-dim);
}
.thumb-frame {
  width: 1000px; height: 700px; border: none;
  transform: scale(.30); transform-origin: 0 0; pointer-events: none;
}
.thumb-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  height: 100%; color: var(--text-dim); font-size: 13px;
}
.thumb-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: color-mix(in srgb, var(--bg) 70%, transparent); color: var(--text); font-size: 13px; font-weight: 600;
}
.thumb-stale {
  position: absolute; top: 8px; right: 8px;
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  color: var(--yellow); background: color-mix(in srgb, var(--yellow) 18%, var(--bg-surface));
}

.screen-meta { padding: 10px 12px 6px; }
.screen-name { font-size: 13.5px; font-weight: 600; color: var(--text); text-transform: capitalize; }
.screen-actions { display: flex; gap: 6px; padding: 0 12px 12px; flex-wrap: wrap; }

.modify-box { padding: 0 12px 12px; }
.modify-input {
  width: 100%; box-sizing: border-box; font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--bg);
  color: var(--text); outline: none; font-family: inherit;
}
.modify-actions { display: flex; gap: 6px; margin-top: 7px; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
