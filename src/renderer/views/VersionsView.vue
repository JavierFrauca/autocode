<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { History, RotateCcw, CheckCircle2, AlertTriangle, FolderOpen, Play, Square } from "lucide-vue-next";
import type { AppType } from "@shared";
import { api, timeAgo, formatDbDate } from "../api";

const route = useRoute();
const projectId = computed(() => route.params.projectId as string);
const appType = ref<AppType>("server");

// "Probar": AutoCode arranca la app de la versión ACTIVA para que el usuario la VEA —web en el
// navegador, escritorio en su propia ventana— sin instalar nada. (MCP no aplica: se conecta a un cliente.)
const previewStarting = ref(false);
const previewUrl = ref<string | null>(null);
const previewKind = ref<"web" | "desktop" | null>(null);
// Web = login (credenciales del admin sembrado). Servicio API = API key sembrada. Para poder entrar a probar.
const previewCreds = ref<{ email: string; password: string } | null>(null);
const previewApiKey = ref<string | null>(null);
const previewRunning = computed(() => !!previewUrl.value || previewKind.value === "desktop");

interface Version { id: string; date: string; label: string }

const versions = ref<Version[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const confirming = ref<string | null>(null);
const reverting = ref(false);
const notice = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    versions.value = await api.versions(projectId.value);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

// La etiqueta del backend lleva "✅ Versión que funciona — <proyecto> (intento N)".
// Mostramos algo limpio al usuario.
function cleanLabel(label: string): string {
  return label.replace(/^✅\s*Versión que funciona\s*—\s*/i, "").trim() || "Versión guardada";
}

async function openFolder() {
  error.value = null;
  try {
    await api.openAppFolder(projectId.value);
    notice.value = "Abriendo la carpeta de la app en el explorador…";
    setTimeout(() => (notice.value = null), 4000);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

async function loadArch() {
  try { appType.value = (await api.ensureArchitecture(projectId.value)).appType; } catch { /* server por defecto */ }
}
async function loadPreviewStatus() {
  try {
    const s = await api.previewStatus(projectId.value);
    if (s.running) { previewUrl.value = s.url; previewKind.value = s.kind; previewCreds.value = s.credenciales ?? null; previewApiKey.value = s.apiKey ?? null; }
  } catch { /* sin preview */ }
}
async function startPreview() {
  if (previewStarting.value) return;
  previewStarting.value = true;
  error.value = null;
  try {
    const r = await api.previewStart(projectId.value);
    previewUrl.value = r.url;
    previewKind.value = r.kind;
    previewCreds.value = r.credenciales ?? null;
    previewApiKey.value = r.apiKey ?? null;
    notice.value = r.kind === "desktop" ? "Abriendo la aplicación…" : "Abriendo la app en tu navegador…";
    setTimeout(() => (notice.value = null), 5000);
  } catch (e: any) {
    error.value = `No se pudo arrancar la app: ${e?.message ?? e}`;
  } finally {
    previewStarting.value = false;
  }
}
async function stopPreview() {
  try { await api.previewStop(projectId.value); } catch {}
  previewUrl.value = null;
  previewKind.value = null;
  previewCreds.value = null;
  previewApiKey.value = null;
}

async function doRevert(id: string) {
  reverting.value = true;
  error.value = null;
  try {
    await api.revertVersion(projectId.value, id);
    confirming.value = null;
    notice.value = "Listo. Tu proyecto ha vuelto a esa versión.";
    await load();
    setTimeout(() => (notice.value = null), 5000);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    reverting.value = false;
  }
}

onMounted(() => { load(); loadArch(); loadPreviewStatus(); });
</script>

<template>
  <div class="versions">
    <div class="versions-head">
      <div class="versions-title">
        <History :size="20" :stroke-width="2" />
        <h2>Versiones que funcionan</h2>
      </div>
      <p class="versions-sub">
        Cada vez que tu app pasa todas las pruebas, AutoCode guarda una copia a la que puedes volver
        en cualquier momento. Así nunca pierdes una versión que funcionaba.
      </p>
      <button class="btn-openfolder" @click="openFolder">
        <FolderOpen :size="15" :stroke-width="2" /> Abrir la carpeta de la app
      </button>
    </div>

    <div v-if="notice" class="versions-notice ok">
      <CheckCircle2 :size="16" :stroke-width="2" /> {{ notice }}
    </div>
    <div v-if="error" class="versions-notice err">
      <AlertTriangle :size="16" :stroke-width="2" /> {{ error }}
    </div>

    <div v-if="loading" class="versions-empty">Cargando…</div>

    <div v-else-if="versions.length === 0" class="versions-empty">
      Aún no hay versiones guardadas. Se creará una automáticamente la primera vez que tu app
      pase las pruebas.
    </div>

    <ul v-else class="versions-list">
      <li v-for="(v, i) in versions" :key="v.id" class="version-item" :class="{ current: i === 0 }">
        <div class="version-dot" />
        <div class="version-body">
          <div class="version-row">
            <strong class="version-label">{{ cleanLabel(v.label) }}</strong>
            <span v-if="i === 0" class="version-badge">Versión actual</span>
          </div>
          <div class="version-meta">
            {{ timeAgo(v.date) }} · {{ formatDbDate(v.date) }}
          </div>

          <div v-if="confirming === v.id" class="version-confirm">
            <span>¿Volver a esta versión? Lo que hayas cambiado después se guardará por si acaso.</span>
            <div class="version-confirm-actions">
              <button class="btn-revert" :disabled="reverting" @click="doRevert(v.id)">
                {{ reverting ? "Volviendo…" : "Sí, volver aquí" }}
              </button>
              <button class="btn-ghost" :disabled="reverting" @click="confirming = null">Cancelar</button>
            </div>
          </div>
        </div>

        <!-- Versión ACTIVA: acción "Probar" (web/escritorio). MCP no se 'abre' → carpeta. -->
        <template v-if="i === 0">
          <template v-if="appType !== 'mcp'">
            <button v-if="!previewRunning" class="btn-probar version-action" :disabled="previewStarting" @click="startPreview"
                    title="Arranca esta versión para verla y probarla (sin instalar nada)">
              <Play :size="14" :stroke-width="2" /> {{ previewStarting ? "Arrancando…" : "Probar" }}
            </button>
            <template v-else>
              <button v-if="previewKind === 'web'" class="btn-probar version-action" @click="startPreview">
                <Play :size="14" :stroke-width="2" /> Abrir de nuevo
              </button>
              <button class="btn-ghost version-action stop-btn" @click="stopPreview">
                <Square :size="13" :stroke-width="2" /> Parar
              </button>
            </template>
          </template>
          <button v-else class="btn-ghost version-action" @click="openFolder">
            <FolderOpen :size="14" :stroke-width="2" /> Abrir carpeta
          </button>
          <div v-if="previewRunning && previewCreds" style="flex-basis:100%; font-size:12px; color:var(--text-muted); margin-top:4px;">
            Para entrar: <code style="background:var(--bg);padding:1px 5px;border-radius:4px;">{{ previewCreds.email }}</code>
            / <code style="background:var(--bg);padding:1px 5px;border-radius:4px;">{{ previewCreds.password }}</code> (clave de un solo uso)
          </div>
          <div v-if="previewRunning && previewApiKey" style="flex-basis:100%; font-size:12px; color:var(--text-muted); margin-top:4px;">
            API key: <code style="background:var(--bg);padding:1px 5px;border-radius:4px;">{{ previewApiKey }}</code> (cabecera Authorization: Bearer …)
          </div>
        </template>
        <button
          v-else-if="confirming !== v.id"
          class="btn-ghost version-action"
          @click="confirming = v.id"
        >
          <RotateCcw :size="14" :stroke-width="2" /> Volver a esta versión
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.versions { max-width: 760px; margin: 0 auto; padding: 24px 20px; }
.versions-head { margin-bottom: 20px; }
.versions-title { display: flex; align-items: center; gap: 10px; color: var(--text); }
.versions-title h2 { margin: 0; font-size: 19px; }
.versions-sub { color: var(--text-muted); font-size: 13px; margin: 8px 0 0; line-height: 1.5; }
.btn-openfolder {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 12px;
  background: transparent; border: 1px solid var(--border); color: var(--text);
  padding: 8px 14px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; font-weight: 600;
  font-family: inherit;
}
.btn-openfolder:hover { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }

.versions-notice {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: var(--r); font-size: 13px; margin-bottom: 14px;
}
.versions-notice.ok  { background: color-mix(in srgb, var(--green) 14%, transparent); color: var(--green); }
.versions-notice.err { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--red); }

.versions-empty {
  padding: 36px 20px; text-align: center; color: var(--text-muted);
  border: 1px dashed var(--border); border-radius: var(--r-lg); font-size: 14px;
}

.versions-list { list-style: none; margin: 0; padding: 0; }
.version-item {
  display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px 12px;
  padding: 14px 14px; border: 1px solid var(--border); border-radius: var(--r-lg);
  margin-bottom: 10px; background: var(--bg-surface);
}
.version-item.current { border-color: var(--accent); }
.version-dot {
  width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; flex-shrink: 0;
  background: var(--border);
}
.version-item.current .version-dot { background: var(--accent); }
.version-body { flex: 1; min-width: 0; }
.version-row { display: flex; align-items: center; gap: 8px; }
.version-label { color: var(--text); font-size: 14px; }
.version-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
}
.version-meta { color: var(--text-dim); font-size: 12px; margin-top: 3px; }

.version-confirm {
  margin-top: 10px; padding: 10px 12px; border-radius: var(--r);
  background: var(--bg-hover); font-size: 13px; color: var(--text-muted);
}
.version-confirm-actions { display: flex; gap: 8px; margin-top: 8px; }

.version-action { flex-shrink: 0; display: flex; align-items: center; gap: 6px; }

.btn-probar {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--accent); color: #fff; border: none;
  padding: 7px 14px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; font-weight: 600;
  font-family: inherit;
}
.btn-probar:hover:not(:disabled) { filter: brightness(1.07); }
.btn-probar:disabled { opacity: .65; cursor: default; }
.btn-revert {
  background: var(--accent); color: white; border: none;
  padding: 7px 14px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; font-weight: 600;
}
.btn-revert:disabled { opacity: .6; cursor: default; }
.btn-ghost {
  background: transparent; border: 1px solid var(--border); color: var(--text-muted);
  padding: 7px 12px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px;
}
.btn-ghost:hover { background: var(--bg-hover); color: var(--text); }
/* "Parar" la app arrancada: ámbar (no es un error, pero corta algo en marcha). El icono hereda el color. */
.stop-btn { color: var(--amber, #d9920a); border-color: color-mix(in srgb, var(--amber, #d9920a) 45%, var(--border)); }
.stop-btn:hover { background: color-mix(in srgb, var(--amber, #d9920a) 14%, transparent); color: var(--amber, #d9920a); }
</style>
