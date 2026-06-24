<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { RotateCcw, CheckCircle2, AlertTriangle, FolderOpen, Play, Square, Package, Loader2 } from "lucide-vue-next";
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

// ── Distribución (repartir la app) ───────────────────────────────────────────────────────────
// Escritorio → instalador .exe; web/servicio API → paquete de despliegue (.zip Docker). MCP no aplica.
const packageState = ref<"none" | "running" | "done" | "failed">("none");
const installerPath = ref<string | null>(null);
const packageError = ref<string | null>(null);
let pkgTimer: any = null;
const canPackage = computed(() => appType.value === "electron" || appType.value === "server" || appType.value === "api");
const pkgLabels = computed(() =>
  appType.value === "electron"
    ? { action: "Preparar instalador (.exe)", retry: "Reintentar instalador", running: "Preparando el instalador…", reveal: "Abrir carpeta del instalador",
        title: "Genera un instalador (.exe) para repartir la app a quien no sabe compilar",
        noteRunning: "Preparando el instalador… puede tardar unos minutos (la 1ª vez descarga componentes de Electron). Puedes seguir trabajando.",
        noteOk: "✅ Instalador listo. Pulsa «Abrir carpeta del instalador» para coger el .exe y repartirlo — se instala con doble clic." }
    : { action: "Generar paquete de despliegue", retry: "Reintentar paquete", running: "Generando el paquete…", reveal: "Abrir carpeta del paquete",
        title: "Genera un .zip (Dockerfile + docker-compose) para que tu equipo de IT lo despliegue",
        noteRunning: "Generando el paquete de despliegue…",
        noteOk: "✅ Paquete listo. Pulsa «Abrir carpeta del paquete» para coger el .zip y pasárselo a IT — lo despliegan con «docker compose up»." },
);
async function loadPackageStatus() {
  try {
    const s = await api.packageStatus(projectId.value);
    packageState.value = s.state;
    installerPath.value = s.installerPath ?? s.bundlePath ?? null;
    packageError.value = s.error ?? null;
  } catch { /* sin estado: deja lo que haya */ }
}
function startPkgPoll() {
  clearInterval(pkgTimer);
  pkgTimer = setInterval(async () => { await loadPackageStatus(); if (packageState.value !== "running") clearInterval(pkgTimer); }, 3000);
}
async function startPackage() {
  if (packageState.value === "running") return;
  packageError.value = null;
  packageState.value = "running";
  try { await api.packageApp(projectId.value); }
  catch (e: any) { packageState.value = "failed"; packageError.value = e?.message ?? String(e); return; }
  startPkgPoll();
}
async function cancelPackaging() {
  try { await api.cancelPackage(projectId.value); } catch {}
  await loadPackageStatus();
}
async function revealInstaller() {
  try { await api.revealInstaller(projectId.value); }
  catch (e: any) { packageError.value = e?.message ?? String(e); }
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

onMounted(() => {
  load(); loadArch(); loadPreviewStatus();
  loadPackageStatus().then(() => { if (packageState.value === "running") startPkgPoll(); });
});
onBeforeUnmount(() => { clearInterval(pkgTimer); });
</script>

<template>
  <div class="versions">
    <div class="versions-head">
      <div class="versions-title">
        <Play :size="20" :stroke-width="2" />
        <h2>Ejecutar y versiones</h2>
      </div>
      <p class="versions-sub">
        Aquí pruebas tu aplicación, la preparas para repartir y vuelves a cualquier versión que
        funcionaba. Cada vez que tu app pasa las pruebas, AutoCode guarda una copia automáticamente.
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

    <!-- Héroe: el momento "mi app funciona" → Probar bien grande. -->
    <div v-if="versions.length" class="run-hero">
      <div class="run-hero-text">
        <CheckCircle2 :size="18" :stroke-width="2.4" />
        <strong>Tu aplicación está lista.</strong>
        <span class="muted">Ábrela y pruébala de principio a fin, sin instalar nada.</span>
      </div>
      <div class="run-hero-actions">
        <template v-if="appType !== 'mcp'">
          <button v-if="!previewRunning" class="run-hero-btn" :disabled="previewStarting" @click="startPreview"
                  title="Arranca tu app para verla y probarla (sin instalar nada)">
            <Play :size="18" :stroke-width="2.2" /> {{ previewStarting ? "Arrancando…" : "Probar mi aplicación" }}
          </button>
          <template v-else>
            <button v-if="previewKind === 'web'" class="run-hero-btn" @click="startPreview">
              <Play :size="18" :stroke-width="2.2" /> Abrir de nuevo
            </button>
            <button class="btn-ghost stop-btn" @click="stopPreview">
              <Square :size="14" :stroke-width="2" /> Parar
            </button>
          </template>
        </template>
        <button v-else class="run-hero-btn" @click="openFolder">
          <FolderOpen :size="16" :stroke-width="2" /> Abrir carpeta
        </button>
      </div>
      <div v-if="previewRunning && previewCreds" class="run-hero-creds">
        Para entrar: <code>{{ previewCreds.email }}</code> / <code>{{ previewCreds.password }}</code>
        <span class="muted"> — clave de prueba; entra siempre.</span>
      </div>
      <div v-if="previewRunning && previewApiKey" class="run-hero-creds">
        API key: <code>{{ previewApiKey }}</code> <span class="muted"> — cabecera Authorization: Bearer …</span>
      </div>
    </div>

    <!-- Distribuir: repartir la app (instalador .exe / paquete Docker). Solo si hay versión y el tipo lo admite. -->
    <div v-if="canPackage && versions.length" class="distribute-card">
      <div class="distribute-head">
        <Package :size="17" :stroke-width="2" />
        <strong>{{ appType === 'electron' ? 'Repartir la aplicación' : 'Preparar para desplegar' }}</strong>
      </div>
      <div class="distribute-actions">
        <button v-if="packageState === 'none' || packageState === 'failed'" class="btn-probar" :title="pkgLabels.title" @click="startPackage">
          <Package :size="14" :stroke-width="2" /> {{ packageState === 'failed' ? pkgLabels.retry : pkgLabels.action }}
        </button>
        <span v-else-if="packageState === 'running'" class="pkg-running">
          <Loader2 class="spin" :size="14" :stroke-width="2" /> {{ pkgLabels.running }}
        </span>
        <button v-else-if="packageState === 'done'" class="btn-probar" @click="revealInstaller">
          <FolderOpen :size="14" :stroke-width="2" /> {{ pkgLabels.reveal }}
        </button>
        <button v-if="packageState === 'running'" class="btn-ghost" @click="cancelPackaging">
          <Square :size="13" :stroke-width="2" /> Cancelar
        </button>
      </div>
      <div v-if="packageState !== 'none' || packageError" class="pkg-note">
        <span v-if="packageState === 'running'" class="muted">{{ pkgLabels.noteRunning }}</span>
        <span v-else-if="packageState === 'done'" class="pkg-ok">{{ pkgLabels.noteOk }}</span>
        <span v-else-if="packageError" class="pkg-err">{{ packageError }}</span>
      </div>
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

        <!-- Volver a una versión anterior (la actual no: se prueba arriba, en el héroe). -->
        <button
          v-if="i !== 0 && confirming !== v.id"
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

/* ── Héroe "Probar" (el momento mágico) ── */
.run-hero {
  border: 1.5px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, var(--bg-surface)), var(--bg-surface));
  border-radius: var(--r-xl, 16px); padding: 18px 20px; margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.run-hero-text { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; color: var(--text); font-size: 15px; }
.run-hero-text svg { color: var(--green); flex-shrink: 0; }
.run-hero-text .muted { font-size: 13px; flex-basis: 100%; margin-left: 27px; }
.run-hero-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.run-hero-btn {
  display: inline-flex; align-items: center; gap: 9px;
  background: var(--accent); color: #fff; border: none;
  padding: 12px 24px; border-radius: var(--r-lg, 12px); cursor: pointer;
  font-size: 15px; font-weight: 700; font-family: inherit;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 35%, transparent);
  transition: transform .1s, filter .12s;
}
.run-hero-btn:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
.run-hero-btn:active:not(:disabled) { transform: translateY(0); }
.run-hero-btn:disabled { opacity: .7; cursor: default; box-shadow: none; }
.run-hero-creds {
  margin-top: 12px; padding: 9px 12px; border-radius: var(--r);
  background: var(--bg-elevated, var(--bg)); font-size: 12.5px; color: var(--text-muted); line-height: 1.6;
}
.run-hero-creds code { background: var(--bg); padding: 1px 6px; border-radius: 4px; color: var(--text); }

/* ── Distribución ── */
.distribute-card {
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--bg-surface); padding: 14px 16px; margin-bottom: 16px;
}
.distribute-head { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 14px; margin-bottom: 10px; }
.distribute-head svg { color: var(--accent); }
.distribute-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pkg-running { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-muted); }
.pkg-note { margin-top: 10px; font-size: 13px; line-height: 1.5; }
.pkg-ok { color: var(--green); font-weight: 600; }
.pkg-err { color: var(--red); white-space: pre-wrap; word-break: break-word; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

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
