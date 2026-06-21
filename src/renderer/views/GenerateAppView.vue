<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { useAppStore } from "../stores";
import { Rocket, Globe, Monitor, Plug, Webhook, RefreshCw, Sparkles, Circle, Hammer, X, Wrench, CheckCircle2, Play, Package, FolderOpen, Loader2, AlertTriangle, FlaskConical, Copy, Check } from "lucide-vue-next";
import type { AppType } from "@shared";
import ExecutionTunnel from "../components/ExecutionTunnel.vue";
import SplitButton, { type SplitItem } from "../components/SplitButton.vue";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const projectId = computed(() => route.params.projectId as string);

const plan = ref<any>(null);
const planStale = ref(false); // la doc cambió desde que se hizo el plan → ofrecer "Actualizar plan"
const loading = ref(false);
const error = ref<string | null>(null);
const appType = ref<AppType>("server");
// Etiqueta legible del tipo de app detectado.
const appTypeLabel = computed(() =>
  appType.value === "electron" ? "Aplicación de escritorio"
  : appType.value === "mcp" ? "Servidor MCP"
  : appType.value === "api" ? "Servicio API"
  : "Aplicación web");
const runs = ref<any[]>([]);
const projectLoaded = ref(false);

// La generación vive en el store → persiste aunque el usuario navegue y vuelva.
const gen = computed(() => app.generations[projectId.value] ?? null);
const generating = computed(() => gen.value?.status === "running");

// Etiquetas legibles de cada paso real del sistema (de la tabla agent_runs).
const AGENT_LABEL: Record<string, string> = {
  planner: "Diseñando el plan de desarrollo",
  documenter: "Documentando lo conversado",
  coder: "Generando el código",
  qa: "Verificando la calidad",
  reindexer: "Actualizando la búsqueda",
};

// Fases y pasos reales para el túnel de generación del plan (6 fases, todas con agente real).
const GEN_PHASES = ["Conectando", "Analizando", "Planificando", "Documentando", "Indexando", "Revisando"];

const genCurrentPhase = computed(() => {
  const active = runs.value.find((r) => r.status === "running" || r.status === "pending");
  if (active?.agentType === "planner")    return "Planificando";
  if (active?.agentType === "documenter") return "Documentando";
  if (active?.agentType === "reindexer")  return "Indexando";
  const hasReindexer  = runs.value.some((r) => r.agentType === "reindexer");
  if (hasReindexer)  return "Revisando";
  const hasDocumenter = runs.value.some((r) => r.agentType === "documenter");
  if (hasDocumenter) return "Indexando";
  const hasPlanner    = runs.value.some((r) => r.agentType === "planner");
  if (hasPlanner)    return "Documentando";
  return runs.value.length > 0 ? "Analizando" : "Conectando";
});

const genSteps = computed(() =>
  runs.value
    .filter((r) => ["planner", "documenter", "reindexer"].includes(r.agentType))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((r) => ({
      id: r.id,
      phase: r.agentType === "planner"    ? "Planificando"
           : r.agentType === "documenter" ? "Documentando"
           : "Indexando",
      label: AGENT_LABEL[r.agentType] ?? r.agentType,
      detail: null,
      status: r.status === "completed" ? "done" : r.status === "failed" ? "failed" : "running",
    })),
);

// Las tareas planificadas (las 15-20 cosas) extraídas del plan.
const planTasks = computed(() => {
  const out: { id: string; titulo: string; fase: number }[] = [];
  for (const s of plan.value?.sprints ?? [])
    for (const t of s.tareas ?? []) out.push({ id: t.id, titulo: t.titulo, fase: s.numero });
  return out;
});

// ── Progreso del plan ── Cada tarea lleva su estado ("hecho"/"pendiente"): el ejecutor marca como
// hechas las que cada construcción completa. Lo usamos para mostrar qué FASES están terminadas.
const isTaskDone = (t: any) => t?.estado === "hecho";
const sprintDoneCount = (s: any) => (s?.tareas ?? []).filter(isTaskDone).length;
const sprintDone = (s: any) => { const n = s?.tareas?.length ?? 0; return n > 0 && sprintDoneCount(s) === n; };
const planTotalTasks = computed(() =>
  (plan.value?.sprints ?? []).reduce((n: number, s: any) => n + (s.tareas?.length ?? 0), 0));
const planDoneTasks = computed(() =>
  (plan.value?.sprints ?? []).reduce((n: number, s: any) => n + sprintDoneCount(s), 0));
const planProgressPct = computed(() =>
  planTotalTasks.value ? Math.round((planDoneTasks.value / planTotalTasks.value) * 100) : 0);

// El tipo de app YA NO se elige aquí: se deriva del ADR de arquitectura, que el chat va
// completando y se ve en Documentos. Aquí solo se muestra lo detectado. ensure crea el ADR
// por defecto si aún no hay (así el usuario siempre tiene uno, sin saber qué es "arquitectura").
const archIsDefault = ref(true);
async function loadArchitecture() {
  try {
    const a = await api.ensureArchitecture(projectId.value);
    appType.value = a.appType;
    archIsDefault.value = a.isDefault;
  } catch { /* por defecto 'server' */ }
  projectLoaded.value = true;
}

async function loadPlan() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.getPlan(projectId.value);
    plan.value = r?.planJson ?? null;
    // "Caducado" = la documentación cambió desde que se hizo el plan. Se ofrece actualizarlo antes de
    // construir; no se re-planifica solo (el usuario decide).
    planStale.value = !!r?.stale;
  } catch {
    plan.value = null;
    planStale.value = false;
  } finally {
    loading.value = false;
  }
}

function generate() {
  error.value = null;
  plan.value = null;
  planStale.value = false;
  app.startGeneration(projectId.value, appType.value);
}

async function loadRuns() {
  try { runs.value = await api.agentRuns(projectId.value); } catch {}
}

// ── Ejecución del plan (construir la app) — estado en BD, sobrevive a la navegación ──
const execution = ref<any>(null);
const executing = computed(() => execution.value?.status === "running");
// La última construcción terminó con versión válida → habilita probar/validar/distribuir EN EL PLAN.
const builtOk = computed(() => execution.value?.status === "done");

// El asistente de construcción SOLO construye: el túnel se ve mientras corre y, al terminar (bien o
// mal), se vuelve al plan, donde están las acciones (probar, validar, paquete) y el reparador. El
// usuario puede asomarse al plan sin cancelar (tunnelDismissed) y volver al túnel mientras siga vivo.
const tunnelDismissed = ref(false);
const showTunnel = computed(() => executing.value && !tunnelDismissed.value);
watch(executing, (v) => { if (v) tunnelDismissed.value = false; });

async function loadExecution() {
  try { execution.value = await api.getExecution(projectId.value); }
  catch { execution.value = null; }
}

async function build(feedback?: string, fromScratch = false) {
  if (executing.value) return;
  error.value = null;
  try { await api.execute(projectId.value, feedback, fromScratch); }
  catch (e: any) { error.value = e?.message ?? String(e); return; }
  tunnelDismissed.value = false; // arranca la construcción → mostrar el túnel
  await loadExecution();
  startExecPoll();
}

// Menú del split-button de construir: construir/continuar + corregir (reparación dirigida) + reconstruir.
const buildItems: SplitItem[] = [
  { key: "normal", label: "Construir / continuar", description: "Sigue sobre lo ya generado (repara si la app ya existe)." },
  { key: "correct", label: "Corregir aplicación", description: "Describe un fallo y el reparador lo arregla sobre el código actual, sin regenerar." },
  { key: "scratch", label: "Reconstruir desde cero", danger: true, description: "Borra la app actual y la genera de nuevo desde el andamiaje. Útil si quedó rota." },
];
function onBuildSelect(key: string) {
  if (executing.value) return;
  if (key === "scratch") build(undefined, true);
  else if (key === "correct") showCorrect.value = true;
  else build();
}

// Acción POR DEFECTO del split-button, según el estado: la 1ª vez (sin app aún) construye; una vez
// hay app construida, lo más útil es corregirla → el botón principal pasa a "Corregir aplicación".
const appBuilt = computed(() =>
  ["done", "failed", "needs_input"].includes(execution.value?.status));
const buildPrimaryKey = computed(() => (appBuilt.value ? "correct" : "normal"));
const buildPrimaryLabel = computed(() =>
  executing.value ? "Construyendo…" : appBuilt.value ? "Corregir aplicación" : "Construir la aplicación");

// "He validado la app": el usuario da la versión por buena → se reconcilia la documentación con el
// código real (papers, reglas, README). Se ve el resultado en el chat.
const validating = ref(false);
const validated = ref(false);
async function validateVersion() {
  if (validating.value) return;
  validating.value = true;
  error.value = null;
  try {
    await api.validateVersion(projectId.value);
    validated.value = true;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    validating.value = false;
  }
}
// "Crear las pruebas ahora" (voluntario, antes de validar): escribe las pruebas de aceptación sin
// esperar al "OK". Por defecto las pruebas se crean tras validar; esto es solo para adelantarlas.
const writingTests = ref(false);
async function writeTestsNow() {
  if (writingTests.value) return;
  writingTests.value = true;
  error.value = null;
  try {
    await api.writeTests(projectId.value);
    await loadExecution();
    startExecPoll();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    writingTests.value = false;
  }
}
// Reset del flag cuando arranca una nueva construcción.
watch(executing, (v) => { if (v) validated.value = false; });

// "Probar la aplicación" (web): AutoCode instala, construye y arranca la app con SQLite y abre el
// navegador. El usuario la USA para validarla, sin tocar consola.
const previewStarting = ref(false);
const previewUrl = ref<string | null>(null);
// Apps web = login obligatorio → credenciales del admin sembrado. Servicio API → la API key sembrada.
const previewCreds = ref<{ email: string; password: string } | null>(null);
const previewApiKey = ref<string | null>(null);
// Copiar al portapapeles (para que el usuario NO teclee la clave a mano y falle). `copied` marca qué campo
// se acaba de copiar para dar feedback breve.
const copied = ref<string | null>(null);
async function copyText(value: string, field: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = field;
    setTimeout(() => { if (copied.value === field) copied.value = null; }, 1500);
  } catch { /* sin portapapeles: el valor sigue visible para copiarlo a mano */ }
}
async function startPreview() {
  if (previewStarting.value) return;
  previewStarting.value = true;
  error.value = null;
  try {
    const r = await api.previewStart(projectId.value);
    previewUrl.value = r.url;
    previewCreds.value = r.credenciales ?? null;
    previewApiKey.value = r.apiKey ?? null;
  } catch (e: any) {
    error.value = `No se pudo arrancar: ${e?.message ?? e}`;
  } finally {
    previewStarting.value = false;
  }
}
async function stopPreview() {
  try { await api.previewStop(projectId.value); } catch {}
  previewUrl.value = null;
  previewCreds.value = null;
  previewApiKey.value = null;
}
watch(executing, (v) => { if (v) { previewUrl.value = null; previewCreds.value = null; previewApiKey.value = null; } });

async function cancelBuild() {
  try { await api.cancelExecution(projectId.value); } catch (e: any) { error.value = e?.message ?? String(e); }
  await loadExecution();
}

// Corregir aplicación: describes un fallo y se lanza el debugger sobre el código existente (modo
// reparación — el executor detecta que ya hay código y NO regenera ni replanifica).
const showCorrect = ref(false);
const correctText = ref("");
async function launchCorrection() {
  const text = correctText.value.trim();
  if (!text || executing.value) return;
  showCorrect.value = false;
  await build(text);
  correctText.value = "";
}

let execTimer: any = null;
function startExecPoll() {
  clearInterval(execTimer);
  execTimer = setInterval(async () => {
    await loadExecution();
    if (execution.value?.status !== "running") {
      clearInterval(execTimer);
      // Construcción terminada → refrescar el plan para que las fases completadas se vean al volver.
      if (execution.value?.status === "done") { loadPlan(); loadRuns(); }
    }
  }, 2000);
}

// ── Distribución (solo apps de escritorio) ─────────────────────────────────────────────────────
// Empaquetar para distribuir: escritorio → instalador .exe; cliente/servidor → paquete de despliegue
// (.zip con Dockerfile + docker-compose para el sysop). El botón y los textos se adaptan al tipo.
const packageState = ref<"none" | "running" | "done" | "failed">("none");
const installerPath = ref<string | null>(null);
const packageError = ref<string | null>(null);
let pkgTimer: any = null;

// "Distribuir" aplica a escritorio (instalador) y a web/servicio API (paquete de despliegue); no a MCP.
const canPackage = computed(() => appType.value === "electron" || appType.value === "server" || appType.value === "api");
const pkgLabels = computed(() =>
  appType.value === "electron"
    ? {
        action: "Preparar para distribuir", retry: "Reintentar instalador", running: "Preparando el instalador…",
        reveal: "Abrir carpeta del instalador",
        title: "Genera un instalador (.exe) para repartir la app a quien no sabe compilar",
        noteRunning: "Preparando el instalador… puede tardar unos minutos (la primera vez descarga componentes de Electron). Puedes seguir trabajando.",
        noteOk: "✅ Instalador listo. Pulsa «Abrir carpeta del instalador» para copiar el .exe y repartirlo — quien lo reciba lo instala con doble clic.",
      }
    : {
        action: "Generar paquete de despliegue", retry: "Reintentar paquete", running: "Generando el paquete…",
        reveal: "Abrir carpeta del paquete",
        title: "Genera un .zip (Dockerfile + docker-compose) para que tu equipo de IT lo despliegue",
        noteRunning: "Generando el paquete de despliegue…",
        noteOk: "✅ Paquete listo. Pulsa «Abrir carpeta del paquete» para coger el .zip y pasárselo a tu equipo de IT — lo despliegan con «docker compose up».",
      },
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
  pkgTimer = setInterval(async () => {
    await loadPackageStatus();
    if (packageState.value !== "running") clearInterval(pkgTimer);
  }, 3000);
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
// Al empezar una nueva construcción, el instalador anterior deja de ser válido.
watch(executing, (v) => {
  if (v) { clearInterval(pkgTimer); packageState.value = "none"; installerPath.value = null; packageError.value = null; }
});

// Cuando la generación del plan (en el store) termina, cargamos el plan o mostramos el error.
watch(() => gen.value?.status, (s) => {
  if (s === "done") { loadPlan(); loadRuns(); app.clearGeneration(projectId.value); }
  else if (s === "failed") { error.value = gen.value?.error ?? "Error"; app.clearGeneration(projectId.value); }
});

let runsTimer: any = null;
watch(generating, (g) => {
  clearInterval(runsTimer);
  if (g) { loadRuns(); runsTimer = setInterval(loadRuns, 2500); }
}, { immediate: true });
onBeforeUnmount(() => { clearInterval(runsTimer); clearInterval(execTimer); clearInterval(pkgTimer); });

function init() {
  loadArchitecture();
  loadPlan();
  loadRuns();
  loadExecution().then(() => { if (executing.value) startExecPoll(); });
  // Estado de un instalador previo (sobrevive a navegar): si quedó uno en marcha, reanuda el sondeo.
  loadPackageStatus().then(() => { if (packageState.value === "running") startPkgPoll(); });
}
onMounted(init);
watch(projectId, init);
</script>

<template>
  <div class="gen-shell" :class="{ 'exec-mode': showTunnel || generating }">
    <!-- Sin plan aún -->
    <template v-if="!plan && !generating && !loading">
      <div class="gen-empty">
        <div class="gen-empty-icon"><Rocket :size="52" :stroke-width="1.4" /></div>
        <h2>Genera tu aplicación</h2>
        <p class="muted">
          Cuando hayas descrito tu negocio en el chat y tengas algunos documentos,
          pulsa el botón y AutoCode creará un plan de desarrollo completo.
        </p>

        <div class="gen-arch-detected">
          <span class="gen-arch-ico">
            <Monitor v-if="appType === 'electron'" :size="20" :stroke-width="1.7" />
            <Plug v-else-if="appType === 'mcp'" :size="20" :stroke-width="1.7" />
            <Webhook v-else-if="appType === 'api'" :size="20" :stroke-width="1.7" />
            <Globe v-else :size="20" :stroke-width="1.7" />
          </span>
          <div class="gen-arch-text">
            <strong>{{ appTypeLabel }}</strong>
            <span class="gen-arch-sub">
              {{ archIsDefault ? "Es lo que he supuesto. Si no es así, cuéntamelo en el chat." : "Según lo que me has contado." }}
            </span>
          </div>
          <a v-if="archIsDefault" class="gen-arch-link" @click.prevent="router.push(`/projects/${projectId}/chat`)">Ir al chat →</a>
        </div>

        <div v-if="error" class="badge bad" style="margin-bottom:16px">⚠ {{ error }}</div>

        <button class="gen-btn" @click="generate" style="display:inline-flex; align-items:center; gap:10px">
          <Sparkles :size="20" :stroke-width="1.8" /> Generar mi aplicación
        </button>
      </div>
    </template>

    <!-- Cargando plan existente -->
    <div v-else-if="loading" class="gen-loading">
      <div class="spinner" />
      <p class="muted">Cargando plan…</p>
    </div>

    <!-- Generando plan — túnel real -->
    <div v-else-if="generating" class="gen-exec-full">
      <div class="gen-exec-header">
        <div>
          <h2 style="margin:0 0 3px">Generando el plan de tu aplicación…</h2>
          <p class="muted" style="font-size:13px; margin:0">Puede tardar entre 30 segundos y 2 minutos. No cierres la ventana.</p>
        </div>
      </div>
      <div class="gen-exec-tunnel">
        <ExecutionTunnel
          :phases="GEN_PHASES"
          :steps="genSteps"
          :current-phase="genCurrentPhase"
          status="running"
        />
      </div>
    </div>

    <!-- Construyendo la app — túnel a pantalla completa. SOLO construye: al terminar (bien o mal) se
         vuelve al plan, donde están las acciones (probar/validar/paquete) y el reparador. -->
    <div v-else-if="showTunnel" class="gen-exec-full">
      <div class="gen-exec-header">
        <div style="min-width:0">
          <h2 style="margin:0 0 3px">Construyendo tu aplicación…</h2>
          <p class="muted" style="font-size:13px; margin:0">
            Cada paso se actualiza en tiempo real. Puedes volver al plan: la construcción sigue en marcha.
          </p>
        </div>
        <div class="exec-actions">
          <button class="btn ghost" style="gap:6px" @click="tunnelDismissed = true">Ver el plan →</button>
          <button class="btn ghost exec-cancel" @click="cancelBuild">
            <X :size="15" :stroke-width="2" /> Cancelar
          </button>
        </div>
      </div>
      <div class="gen-exec-tunnel">
        <ExecutionTunnel
          :phases="execution.phases"
          :steps="execution.steps"
          :current-phase="execution.currentPhase"
          status="running"
        />
      </div>
    </div>

    <!-- Plan generado -->
    <template v-else-if="plan">
      <div class="plan-shell">
        <!-- Header del plan -->
        <div class="plan-header">
          <div style="min-width:0">
            <h2 style="margin:0 0 2px">{{ plan.app?.nombre ?? "Plan de desarrollo" }}</h2>
            <p class="muted" style="font-size:13px">{{ plan.app?.descripcion }}</p>
            <!-- Progreso global: cuántas tareas del plan se han completado en las construcciones. -->
            <div v-if="planTotalTasks" class="plan-progress">
              <div class="plan-progress-bar"><div class="plan-progress-fill" :style="{ width: planProgressPct + '%' }" /></div>
              <span class="plan-progress-label">{{ planDoneTasks }}/{{ planTotalTasks }} tareas hechas</span>
            </div>
          </div>
          <a class="arch-pill" :title="archIsDefault ? 'Supuesto por defecto — cuéntame en el chat' : 'Según lo que me contaste'"
             @click.prevent="router.push(`/projects/${projectId}/docs`)">
            <Monitor v-if="appType === 'electron'" :size="14" :stroke-width="2" />
            <Plug v-else-if="appType === 'mcp'" :size="14" :stroke-width="2" />
            <Webhook v-else-if="appType === 'api'" :size="14" :stroke-width="2" />
            <Globe v-else :size="14" :stroke-width="2" />
            {{ appType === 'electron' ? 'Escritorio' : appType === 'mcp' ? 'MCP' : appType === 'api' ? 'API' : 'Web' }}
          </a>
          <button class="btn ghost" style="margin-left:8px; gap:6px" @click="generate" :disabled="generating || executing">
            <RefreshCw :size="14" :stroke-width="2" /> Regenerar
          </button>
          <!-- Construir/Corregir/Reconstruir en un solo control. El botón principal es contextual:
               construye la 1ª vez y, una vez hay app, pasa a corregir. -->
          <SplitButton
            style="margin-left:8px"
            :label="buildPrimaryLabel"
            :items="buildItems"
            :disabled="executing"
            @primary="onBuildSelect(buildPrimaryKey)"
            @select="onBuildSelect"
          >
            <template #icon>
              <Wrench v-if="appBuilt && !executing" :size="15" :stroke-width="2" />
              <Hammer v-else :size="15" :stroke-width="2" />
            </template>
          </SplitButton>
        </div>

        <!-- Construcción en curso (el usuario se asomó al plan sin cancelar) → volver al túnel. -->
        <div v-if="executing" class="build-status running">
          <Loader2 class="spin" :size="17" :stroke-width="2.2" />
          <span><strong>Construyendo tu aplicación…</strong> sigue en marcha aunque navegues.</span>
          <button class="btn ghost" style="margin-left:auto; gap:6px" @click="tunnelDismissed = false">Ver construcción →</button>
        </div>

        <!-- Versión construida → acciones (probar, validar, pruebas, distribuir) VIVEN AQUÍ, en el plan. -->
        <div v-else-if="builtOk" class="build-status done">
          <div class="build-status-head">
            <CheckCircle2 :size="18" :stroke-width="2.2" />
            <strong>Aplicación construida.</strong>
            <span class="muted">Pruébala de principio a fin y, cuando la des por buena, valídala.</span>
          </div>
          <div class="build-actions">
            <!-- Probar (web y servicio API): arranca el servidor y abre el navegador -->
            <template v-if="appType === 'server' || appType === 'api'">
              <button v-if="!previewUrl" class="gen-build-btn" style="margin-left:0" @click="startPreview" :disabled="previewStarting"
                      title="Arranca el servidor y lo abre en tu navegador para que lo pruebes (sin instalar nada)">
                <Play :size="15" :stroke-width="2" /> {{ previewStarting ? 'Arrancando…' : (appType === 'api' ? 'Probar el servicio' : 'Probar la aplicación') }}
              </button>
              <template v-else>
                <button class="gen-build-btn" style="margin-left:0" @click="startPreview"><Play :size="15" :stroke-width="2" /> Abrir de nuevo</button>
                <button class="btn ghost stop-btn" style="gap:6px" @click="stopPreview"><X :size="15" :stroke-width="2" /> Parar</button>
              </template>
            </template>
            <!-- He validado / Crear pruebas -->
            <template v-if="!validated">
              <button class="gen-build-btn" style="margin-left:0" @click="validateVersion" :disabled="validating"
                      title="Da la app por válida → crea las pruebas de aceptación y ajusta toda la documentación (papers, reglas, README) al código real">
                <CheckCircle2 :size="15" :stroke-width="2" /> {{ validating ? 'Ajustando documentación…' : 'He validado la app' }}
              </button>
              <button class="btn ghost" style="gap:6px" @click="writeTestsNow" :disabled="writingTests"
                      title="Adelanta la escritura de las pruebas de aceptación (normalmente se crean al validar). Opcional.">
                <FlaskConical :size="15" :stroke-width="2" /> {{ writingTests ? 'Creando pruebas…' : 'Crear las pruebas ahora' }}
              </button>
            </template>
            <span v-else class="validated-pill">
              <CheckCircle2 :size="14" :stroke-width="2" /> Ajustando la documentación — mira el chat
            </span>
            <!-- Distribución: escritorio (instalador .exe) y web (paquete de despliegue) -->
            <template v-if="canPackage">
              <button v-if="packageState === 'none' || packageState === 'failed'" class="gen-build-btn" style="margin-left:0" @click="startPackage"
                      :title="pkgLabels.title">
                <Package :size="15" :stroke-width="2" /> {{ packageState === 'failed' ? pkgLabels.retry : pkgLabels.action }}
              </button>
              <span v-else-if="packageState === 'running'" class="validated-pill">
                <Loader2 class="spin" :size="14" :stroke-width="2" /> {{ pkgLabels.running }}
              </span>
              <button v-else-if="packageState === 'done'" class="gen-build-btn" style="margin-left:0" @click="revealInstaller">
                <FolderOpen :size="15" :stroke-width="2" /> {{ pkgLabels.reveal }}
              </button>
              <button v-if="packageState === 'running'" class="btn ghost" style="gap:6px" @click="cancelPackaging">
                <X :size="14" :stroke-width="2" /> Cancelar
              </button>
            </template>
          </div>
          <!-- Credenciales para entrar a probar la app web (lleva login) -->
          <div v-if="previewUrl && previewCreds" class="preview-creds">
            <strong>Para entrar a probar la app</strong> (lleva login):
            usuario <code>{{ previewCreds.email }}</code>
            <button class="copy-chip" :title="'Copiar usuario'" @click="copyText(previewCreds.email, 'email')">
              <Check v-if="copied === 'email'" :size="12" :stroke-width="2.5" /><Copy v-else :size="12" :stroke-width="2" />
            </button>
            · contraseña <code>{{ previewCreds.password }}</code>
            <button class="copy-chip" :title="'Copiar contraseña'" @click="copyText(previewCreds.password, 'pass')">
              <Check v-if="copied === 'pass'" :size="12" :stroke-width="2.5" /><Copy v-else :size="12" :stroke-width="2" />
            </button>
            <span class="muted"> — clave de prueba fija; entra siempre. En la app real se gestionan los usuarios.</span>
          </div>
          <!-- API key para probar el servicio (se llama por API, no tiene interfaz) -->
          <div v-if="previewUrl && previewApiKey" class="preview-creds">
            <strong>Para llamar al servicio</strong> (cabecera <code>Authorization: Bearer …</code>):
            API key <code>{{ previewApiKey }}</code>
            <button class="copy-chip" :title="'Copiar API key'" @click="copyText(previewApiKey, 'apikey')">
              <Check v-if="copied === 'apikey'" :size="12" :stroke-width="2.5" /><Copy v-else :size="12" :stroke-width="2" />
            </button>
            <span class="muted"> — clave de prueba para esta app; la página que se abre muestra los endpoints.</span>
          </div>
          <!-- Estado del empaquetado -->
          <div v-if="canPackage && (packageState !== 'none' || packageError)" class="pkg-note">
            <span v-if="packageState === 'running'" class="muted">{{ pkgLabels.noteRunning }}</span>
            <span v-else-if="packageState === 'done'" class="pkg-ok">{{ pkgLabels.noteOk }}</span>
            <span v-else-if="packageError" class="exec-why">{{ packageError }}</span>
          </div>
        </div>

        <!-- La última construcción NO terminó → se resuelve DESDE AQUÍ con el reparador o reintentando. -->
        <div v-else-if="execution && (execution.status === 'failed' || execution.status === 'needs_input')" class="build-status failed">
          <div class="build-status-head warn">
            <AlertTriangle :size="18" :stroke-width="2.2" />
            <strong>La última construcción no terminó.</strong>
          </div>
          <div v-if="execution.error" class="exec-why">{{ execution.error }}</div>
          <p class="muted" style="font-size:12.5px; margin:2px 0 0">
            <template v-if="execution.status === 'needs_input'">Te he dejado una pregunta en el chat. </template>
            Dale una pista con <strong>Corregir aplicación</strong> para repararlo, o vuelve a intentarlo.
          </p>
          <div class="build-actions">
            <button class="gen-build-btn" style="margin-left:0" @click="build()" :disabled="executing">
              <RefreshCw :size="15" :stroke-width="2" /> Intentar de nuevo
            </button>
            <button class="btn ghost" style="gap:6px" @click="showCorrect = true">
              <Wrench :size="15" :stroke-width="2" /> Corregir aplicación
            </button>
            <button v-if="execution.status === 'needs_input'" class="btn ghost" style="gap:6px"
                    @click="router.push(`/projects/${projectId}/chat`)">Ir al chat →</button>
          </div>
        </div>

        <!-- Plan CADUCADO: la documentación cambió desde que se hizo el plan. No se re-planifica solo;
             se ofrece actualizarlo antes de construir (decisión: preguntar antes de re-planificar). -->
        <div v-if="planStale" class="plan-stale">
          <AlertTriangle :size="17" :stroke-width="2.2" class="plan-stale-ico" />
          <div class="plan-stale-text">
            <strong>Plan caducado.</strong> Has cambiado la documentación (reglas, decisiones o pantallas)
            desde que se generó este plan. Actualízalo para incluir los nuevos requisitos antes de construir.
          </div>
          <button class="btn primary" style="gap:6px; white-space:nowrap" :disabled="generating || executing" @click="generate">
            <RefreshCw :size="14" :stroke-width="2" /> Actualizar plan
          </button>
        </div>

        <!-- Panel de corrección (modo reparación) -->
        <div v-if="showCorrect" class="correct-panel">
          <div class="correct-title"><Wrench :size="15" :stroke-width="2" /> ¿Qué falla en la aplicación?</div>
          <p class="muted" style="font-size:12.5px; margin:0 0 8px">
            Descríbelo y el reparador lo arreglará sobre el código ya generado — <strong>no se regenera</strong> ni se rehace el plan.
          </p>
          <textarea v-model="correctText" class="exec-feedback" rows="3" style="max-width:680px"
            placeholder="Ej: la ventana se abre pero no se ve nada · al pulsar Exportar no pasa nada · la lista no carga el fichero…" />
          <div style="display:flex; gap:8px; margin-top:8px">
            <button class="gen-build-btn" :disabled="executing || !correctText.trim()" @click="launchCorrection">
              <Wrench :size="14" :stroke-width="2" /> Lanzar reparación
            </button>
            <button class="btn ghost" @click="showCorrect = false">Cancelar</button>
          </div>
        </div>

        <!-- Sprints — cada uno es una FASE; se ve cuáles están terminadas (todas sus tareas hechas). -->
        <div class="sprints">
          <div v-for="sprint in plan.sprints" :key="sprint.numero" class="sprint-card" :class="{ done: sprintDone(sprint) }">
            <div class="sprint-head">
              <span class="sprint-badge">Fase {{ sprint.numero }}</span>
              <strong class="sprint-title">{{ sprint.titulo }}</strong>
              <span class="sprint-count" :class="{ done: sprintDone(sprint) }">
                <CheckCircle2 v-if="sprintDone(sprint)" :size="13" :stroke-width="2.4" />
                {{ sprintDoneCount(sprint) }}/{{ sprint.tareas?.length ?? 0 }}
              </span>
            </div>
            <p class="sprint-objetivo">{{ sprint.objetivo }}</p>
            <div class="sprint-tasks">
              <div v-for="t in sprint.tareas" :key="t.id" class="task-item" :class="{ done: isTaskDone(t) }">
                <CheckCircle2 v-if="isTaskDone(t)" :size="14" :stroke-width="2" class="task-check done" />
                <Circle v-else :size="14" :stroke-width="2" class="task-check" />
                <span class="task-id">{{ t.id }}</span>
                <span class="task-title">{{ t.titulo }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="error" class="badge bad" style="margin:16px 0">⚠ {{ error }}</div>
      </div>
    </template>

  </div>
</template>

<style scoped>
.gen-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--bg);
  padding: 0 0 24px;
}
.gen-shell.exec-mode {
  overflow: hidden;
  padding: 0;
}

/* ── Túnel de ejecución a pantalla completa ── */
.gen-exec-full {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 28px 32px 24px;
  overflow: hidden;
  min-height: 0;
}
.gen-exec-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
  flex-shrink: 0;
}
.gen-exec-tunnel {
  flex: 1;
  min-height: 0;
  display: flex;
}
.exec-actions { display: flex; gap: 8px; align-items: flex-start; flex-shrink: 0; }
.validated-pill {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; color: var(--green);
  background: color-mix(in srgb, var(--green) 12%, transparent);
  border-radius: var(--r); padding: 8px 14px;
}
.exec-cancel { gap: 6px; color: var(--red); border-color: color-mix(in srgb, var(--red) 35%, var(--border)); }
.exec-cancel:hover { background: color-mix(in srgb, var(--red) 10%, transparent); }
/* "Parar" la app arrancada: ámbar (no es un error, pero corta algo en marcha). El icono hereda el color. */
.stop-btn { gap: 6px; color: var(--amber, #d9920a); border-color: color-mix(in srgb, var(--amber, #d9920a) 45%, var(--border)); }
.stop-btn:hover { background: color-mix(in srgb, var(--amber, #d9920a) 14%, transparent); }
/* Distribución: nota de estado del instalador, a ancho completo bajo la cabecera */
.pkg-note { margin: 6px 0 14px; font-size: 13px; flex-shrink: 0; }
.pkg-ok { color: var(--green); font-weight: 600; }
.spin { animation: pkg-spin 1s linear infinite; }
@keyframes pkg-spin { to { transform: rotate(360deg); } }
/* Bloque de "parado": a ancho completo, alineado con el túnel (mismo contenedor) */
.exec-stopped {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
  flex-shrink: 0;
}
.exec-why {
  width: 100%;
  padding: 10px 13px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 25%, transparent);
  border-radius: var(--r);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}
.exec-feedback {
  width: 100%;
  min-height: 46px;
  resize: vertical;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--bg-surface);
  color: var(--text);
}
.exec-feedback:focus { outline: none; border-color: var(--accent); }

/* Panel "Corregir aplicación" */
.correct-panel {
  margin: 0 0 18px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
}
.correct-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 4px;
}

/* ── Estado vacío ── */
.gen-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 48px 24px 24px;
  gap: 14px;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
}
.gen-empty-icon { color: var(--accent); opacity: .9; }
.gen-empty h2   { font-size: 22px; color: var(--text); }
.gen-empty p    { font-size: 15px; max-width: 480px; line-height: 1.65; }

.gen-type-label { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 10px; display: block; }
.gen-type-options {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}
.gen-type-opt {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border: 2px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
  text-align: left;
  flex: 1;
  min-width: 180px;
  box-shadow: var(--shadow-sm);
}
.gen-type-opt:hover  { border-color: var(--accent-border); }
.gen-type-opt.selected { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,76,245,.1); }
.gen-type-opt strong { font-size: 14px; color: var(--text); display: block; margin-bottom: 3px; }
.gen-type-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
.gen-type-icon { font-size: 24px; flex-shrink: 0; }

.gen-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--r-lg);
  padding: 14px 32px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background .15s, transform .1s;
  box-shadow: 0 4px 16px rgba(91,76,245,.35);
}
.gen-btn:hover { background: var(--accent-dark); transform: translateY(-1px); }
.gen-btn:active { transform: translateY(0); }

/* ── Visualización de generación ── */
.gen-viz-shell {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px;
  flex: 1;
}

/* ── Selector de tipo (cambiar de idea) ── */
.type-toggle {
  display: inline-flex;
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
}
.type-toggle button {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 600;
  font-family: inherit;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: background .15s, color .15s;
}
.type-toggle button.on { background: var(--accent); color: #fff; }
.type-toggle button:not(.on):hover { background: var(--bg-hover); color: var(--text); }
.type-change-hint {
  font-size: 12.5px;
  color: var(--accent);
  background: var(--accent-bg, color-mix(in srgb, var(--accent) 10%, transparent));
  border-radius: var(--r);
  padding: 8px 12px;
  margin: 0 0 14px;
}

/* ── Loading ── */
.gen-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 14px;
  padding: 60px;
}
.spinner {
  width: 36px; height: 36px;
  border: 3px solid var(--accent-border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Progreso ── */
.gen-progress-shell {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  flex: 1;
}
.gen-progress-card {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  padding: 32px 36px;
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: center;
}
.gen-progress-icon { display: flex; justify-content: center; color: var(--accent); }
.gen-progress-card h2 { font-size: 20px; color: var(--text); }
.gen-progress-card p  { font-size: 14px; line-height: 1.6; }

.gen-progress-bar {
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}
.gen-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width .8s ease;
}
.gen-progress-label {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
.gen-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  margin-top: 4px;
}
.gen-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.gen-step.done    { color: var(--green); }
.gen-step.current { color: var(--accent); font-weight: 600; }
.gen-step.pending { color: var(--text-dim); }
.gen-step-dot { display: flex; align-items: center; flex-shrink: 0; width: 18px; }

/* ── Plan generado ── */
.plan-shell {
  padding: 24px 28px;
  flex: 1;
}
.plan-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.plan-stale {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -4px 0 20px;
  padding: 12px 14px;
  border: 1px solid #e0a93a;        /* acento ámbar, legible en tema claro y oscuro */
  border-left: 3px solid #e0a93a;
  background: var(--bg-elevated);   /* superficie del tema (NO un crema fijo) */
  border-radius: 10px;
}
.plan-stale-ico { color: #e0a93a; flex-shrink: 0; }
.plan-stale-text { flex: 1; font-size: 13px; line-height: 1.45; color: var(--text); }

/* ── Progreso global del plan (en la cabecera) ── */
.plan-progress { display: flex; align-items: center; gap: 10px; margin-top: 8px; max-width: 420px; }
.plan-progress-bar { flex: 1; height: 6px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
.plan-progress-fill { height: 100%; background: var(--green); border-radius: 3px; transition: width .5s ease; }
.plan-progress-label { font-size: 12px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }

/* ── Estado de la construcción (en el plan): en curso / construida / no terminó ── */
.build-status {
  margin: -4px 0 20px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
}
.build-status.running { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text); }
.build-status.done { border-color: color-mix(in srgb, var(--green) 40%, var(--border)); background: color-mix(in srgb, var(--green) 6%, var(--bg-surface)); }
.build-status.failed { border-color: color-mix(in srgb, var(--red) 35%, var(--border)); background: color-mix(in srgb, var(--red) 6%, var(--bg-surface)); }
.build-status-head { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text); }
.build-status-head svg { color: var(--green); flex-shrink: 0; }
.build-status-head.warn svg { color: var(--red); }
.build-status-head .muted { font-weight: 400; }
.build-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.preview-creds {
  margin-top: 10px; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elevated);
  font-size: 13px; line-height: 1.7;
}
.preview-creds code { background: var(--bg); padding: 2px 6px; border-radius: 4px; }
.copy-chip {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 20px; margin: 0 2px; padding: 0; vertical-align: middle;
  border: 1px solid var(--border); border-radius: 5px; background: var(--bg);
  color: var(--text-muted); cursor: pointer;
}
.copy-chip:hover { color: var(--text); border-color: var(--accent); }

.sprints {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sprint-card {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
}
/* Fase terminada: todas sus tareas hechas → acento verde sutil. */
.sprint-card.done { border-color: color-mix(in srgb, var(--green) 35%, var(--border)); }
.sprint-count {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  color: var(--text-dim); padding: 2px 8px; border-radius: 20px; background: var(--bg);
}
.sprint-count.done { color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent); }
.sprint-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.sprint-badge {
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent-border);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 10px;
}
.sprint-title { font-size: 14px; font-weight: 700; color: var(--text); }
.sprint-objetivo { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5; }

.sprint-tasks { display: flex; flex-direction: column; gap: 5px; }
.task-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg);
  border-radius: var(--r-sm);
  font-size: 13px;
}
.task-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
  min-width: 50px;
}
.task-title { color: var(--text); }
.task-check { color: var(--text-dim); flex-shrink: 0; }
/* Tarea hecha: check verde + título atenuado, para ver de un vistazo qué se ha completado. */
.task-item.done { background: color-mix(in srgb, var(--green) 7%, var(--bg)); }
.task-check.done { color: var(--green); }
.task-item.done .task-title { color: var(--text-muted); }

/* ── Botón construir + túnel ── */
.gen-build-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: 8px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background .15s;
}
.gen-build-btn:hover:not(:disabled) { background: var(--accent-dark); }
.gen-build-btn:disabled { opacity: .65; cursor: default; }
.exec-tunnel-box {
  margin: 18px 0 20px;
  padding: 18px;
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--bg);
}
.exec-needs-input {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 11px 14px;
  border-radius: var(--r);
  background: color-mix(in srgb, var(--amber, #d9920a) 12%, transparent);
  color: var(--text);
  font-size: 13px;
}
.exec-needs-input a {
  color: var(--accent);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

/* ── Panel de progreso (con ticks reales) ── */
.exec-panel {
  margin: 18px 24px 8px;
  padding: 16px 18px;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}
.exec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 12px;
}
.exec-steps { display: flex; flex-direction: column; gap: 7px; }
.exec-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--text-muted);
}
.exec-step.done, .exec-step.applied { color: var(--text); }
.exec-step.failed, .exec-step.cancelled { color: var(--red); }
.exec-ico { display: flex; align-items: center; flex-shrink: 0; color: var(--text-dim); }
.exec-step.done .exec-ico, .exec-step.applied .exec-ico { color: var(--green); }
.exec-step.running .exec-ico, .exec-step.pending .exec-ico { color: var(--accent); }
.exec-step.failed .exec-ico, .exec-step.cancelled .exec-ico { color: var(--red); }
.exec-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border-dim);
  line-height: 1.5;
}
.spin { animation: spin .8s linear infinite; }

/* ── Arquitectura detectada (solo lectura) ── */
.gen-arch-detected {
  display: flex; align-items: center; gap: 12px;
  width: 100%; max-width: 460px;
  padding: 12px 16px; margin-bottom: 8px;
  border: 1.5px solid var(--border); border-radius: var(--r-lg);
  background: var(--bg-surface);
}
.gen-arch-ico { color: var(--accent); flex-shrink: 0; display: flex; }
.gen-arch-text { display: flex; flex-direction: column; text-align: left; }
.gen-arch-text strong { font-size: 14px; color: var(--text); }
.gen-arch-sub { font-size: 12px; color: var(--text-muted); }
.gen-arch-link { margin-left: auto; color: var(--accent); font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.arch-pill {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  background: var(--accent-bg, color-mix(in srgb, var(--accent) 12%, transparent));
  color: var(--accent); border: none; border-radius: 999px;
  padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer; text-decoration: none;
}
</style>
