<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../api";
import { useAppStore } from "../stores";
import {
  FolderOpen, Bot, CheckCircle, Cloud, Server, Sparkles, Zap, Search, Lock,
  KeyRound, Plug, ChevronRight, ChevronLeft, CheckCheck, RefreshCw,
} from "lucide-vue-next";

const app = useAppStore();

type ProviderId = "anthropic" | "openai" | "deepseek" | "qwen" | "kimi" | "groq" | "openrouter" | "local";

const form = reactive({
  generation: {
    mode: "cloud" as "cloud" | "local",
    provider: "anthropic" as ProviderId,
    baseUrl: "",
    apiKey: "",
    mainModel: "",
    fastModel: "",
  },
  projectsRoot: "",
  qdrantUrl: "http://127.0.0.1:6333",
});

const cloudProviders: { id: ProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "qwen", label: "Qwen" },
  { id: "kimi", label: "Kimi" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
];

const apiKeySet = ref(false);
const saving = ref(false);
const savedAt = ref<string | null>(null);
const saveError = ref<string | null>(null);
const verifying = ref(false);
const verifyResults = ref<any>(null);
const verifyError = ref<string | null>(null);
const currentStep = ref(0);

const models = ref<string[]>([]);
const modelsLoading = ref(false);
const modelsError = ref<string | null>(null);
const connecting = ref(false);

const steps = [
  { id: "folder", title: "Carpeta de trabajo", Icon: FolderOpen },
  { id: "ai",     title: "Servidor de IA",     Icon: Bot },
  { id: "verify", title: "Comprobar conexión", Icon: CheckCircle },
];

function setMode(mode: "cloud" | "local") {
  form.generation.mode = mode;
  if (mode === "local") form.generation.provider = "local";
  else if (form.generation.provider === "local") form.generation.provider = "anthropic";
  models.value = [];
}
function selectProvider(id: ProviderId) {
  form.generation.provider = id;
  models.value = [];
}

async function loadModels() {
  modelsLoading.value = true;
  modelsError.value = null;
  try {
    const r = await api.availableModels();
    models.value = r.models ?? [];
    if (models.value.length === 0) {
      modelsError.value = "El proveedor no devolvió una lista. Escribe el nombre del modelo a mano.";
    }
  } catch (e: any) {
    modelsError.value = e?.message ?? "No se pudo obtener la lista de modelos";
  } finally {
    modelsLoading.value = false;
  }
}

// "Conectar" = guardar proveedor+clave y traer la lista de modelos de ese proveedor.
async function connect() {
  connecting.value = true;
  try {
    await save();
    await loadModels();
  } finally {
    connecting.value = false;
  }
}

async function load() {
  const cfg = await api.getConfig();
  const g = cfg.generation ?? {};
  form.generation.mode = g.mode ?? "cloud";
  form.generation.provider = g.provider ?? "anthropic";
  form.generation.baseUrl = g.baseUrl ?? "";
  form.generation.apiKey = "";
  form.generation.mainModel = g.mainModel ?? "";
  form.generation.fastModel = g.fastModel ?? "";
  apiKeySet.value = !!g.apiKeySet;
  form.projectsRoot = cfg.projectsRoot ?? "";
  form.qdrantUrl = cfg.qdrantUrl ?? "http://127.0.0.1:6333";
}

async function save() {
  saving.value = true;
  saveError.value = null;
  try {
    await api.saveConfig({ ...form });
    if (form.generation.apiKey) apiKeySet.value = true;
    form.generation.apiKey = "";
    savedAt.value = new Date().toLocaleTimeString();
    await app.refreshHealth();
  } catch (e: any) {
    saveError.value = e?.message ?? String(e);
  } finally {
    saving.value = false;
  }
}

async function verify() {
  verifying.value = true;
  verifyError.value = null;
  verifyResults.value = null;
  try {
    verifyResults.value = await api.verifyConfig();
  } catch (e: any) {
    verifyError.value = e?.message ?? String(e);
  } finally {
    verifying.value = false;
  }
}

const endpointReady = computed(() =>
  form.generation.mode === "local"
    ? !!form.generation.baseUrl
    : (!!form.generation.apiKey || apiKeySet.value),
);

const verifyNames: Record<string, string> = {
  provider:   "Proveedor de IA",
  main:       "Modelo principal",
  fast:       "Modelo rápido",
  tools:      "Generar apps (function-calling)",
  embeddings: "Búsqueda semántica (local)",
};

const stepStatus = computed(() => ({
  folder: form.projectsRoot ? "done" : "pending",
  ai: endpointReady.value && form.generation.mainModel && form.generation.fastModel ? "done" : "pending",
  verify: verifyResults.value
    ? (["provider", "main", "fast"].every((k) => verifyResults.value?.[k]?.ok) ? "done" : "error")
    : "pending",
}));

onMounted(load);
</script>

<template>
  <div class="settings-shell">
    <!-- Sidebar de pasos -->
    <aside class="settings-sidebar">
      <div class="settings-sidebar-title">Configuración</div>
      <div v-if="savedAt" class="saved-notice">✓ Guardado a las {{ savedAt }}</div>
      <div v-if="saveError" class="error-notice">⚠ {{ saveError }}</div>

      <div class="step-list">
        <div
          v-for="(s, i) in steps"
          :key="s.id"
          class="step-item"
          :class="[stepStatus[s.id as keyof typeof stepStatus], { active: currentStep === i }]"
          @click="currentStep = i"
        >
          <span class="step-icon"><component :is="s.Icon" :size="17" :stroke-width="1.8" /></span>
          <div class="step-text">
            <strong>{{ s.title }}</strong>
            <span class="step-status-label">
              {{ stepStatus[s.id as keyof typeof stepStatus] === 'done' ? 'Completo' : 'Pendiente' }}
            </span>
          </div>
          <CheckCheck v-if="stepStatus[s.id as keyof typeof stepStatus] === 'done'" :size="14" :stroke-width="2.5" class="step-check-icon" />
        </div>
      </div>

      <button class="btn primary" style="width:100%; margin-top:16px" @click="save" :disabled="saving">
        {{ saving ? "Guardando…" : "Guardar todo" }}
      </button>
    </aside>

    <!-- Contenido del paso -->
    <div class="settings-content">

      <!-- Paso 0: Carpeta de trabajo -->
      <div v-show="currentStep === 0" class="step-body">
        <div class="step-header">
          <div class="step-header-icon"><FolderOpen :size="32" :stroke-width="1.5" /></div>
          <div>
            <h2>Carpeta de trabajo</h2>
            <p class="muted">AutoCode guardará aquí todos tus proyectos, documentos y apps generadas.</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label">¿Dónde quieres guardar tus proyectos?</label>
          <input v-model="form.projectsRoot" placeholder="Ej: C:\MisProyectos  o  /Users/carlos/proyectos" />
          <p class="field-hint">Cada proyecto tendrá su propia subcarpeta dentro de esta ruta. Si la carpeta no existe, AutoCode la creará.</p>
        </div>

        <div class="step-actions">
          <button class="btn primary" @click="currentStep = 1">Siguiente →</button>
        </div>
      </div>

      <!-- Paso 1: Servidor de IA (v2: proveedor + 2 modelos) -->
      <div v-show="currentStep === 1" class="step-body">
        <div class="step-header">
          <div class="step-header-icon"><Bot :size="32" :stroke-width="1.5" /></div>
          <div>
            <h2>¿Quién piensa por AutoCode?</h2>
            <p class="muted">Conecta un proveedor en la nube y pega tu clave. O usa tu propio equipo si lo prefieres.</p>
          </div>
        </div>

        <div class="privacy-banner">
          <Lock :size="16" :stroke-width="2" />
          <span>Tus documentos y la <strong>búsqueda interna se quedan en tu equipo</strong>. Solo la generación usa el proveedor que elijas.</span>
        </div>

        <!-- Modo -->
        <div class="mode-grid">
          <button type="button" class="mode-card" :class="{ active: form.generation.mode === 'cloud' }" @click="setMode('cloud')">
            <div class="mode-card-head"><Cloud :size="19" :stroke-width="1.8" /> En la nube <span class="reco">recomendado</span></div>
            <div class="mode-card-sub">Pega una API key y listo. Sin instalar nada.</div>
          </button>
          <button type="button" class="mode-card" :class="{ active: form.generation.mode === 'local' }" @click="setMode('local')">
            <div class="mode-card-head"><Server :size="19" :stroke-width="1.8" /> En tu equipo</div>
            <div class="mode-card-sub">Ollama · LM Studio · tu LiteLLM. Avanzado.</div>
          </button>
        </div>

        <!-- Proveedor cloud -->
        <template v-if="form.generation.mode === 'cloud'">
          <label class="section-label">Proveedor</label>
          <div class="provider-grid">
            <button
              v-for="p in cloudProviders" :key="p.id" type="button"
              class="provider-chip" :class="{ active: form.generation.provider === p.id }"
              @click="selectProvider(p.id)"
            >{{ p.label }}</button>
          </div>

          <div class="field">
            <label class="field-label">API key</label>
            <div class="key-row">
              <KeyRound :size="16" class="key-icon" />
              <input
                v-model="form.generation.apiKey" type="password" autocomplete="off"
                :placeholder="apiKeySet ? '••• clave guardada — déjalo vacío para no cambiarla' : 'Pega tu clave del proveedor'"
              />
            </div>
            <p class="field-hint">La generación se factura en tu cuenta del proveedor, por uso.</p>
          </div>
        </template>

        <!-- Local -->
        <template v-else>
          <div class="field">
            <label class="field-label">Dirección de tu servidor</label>
            <input v-model="form.generation.baseUrl" placeholder="Ej: http://192.168.1.38:4000  (no añadas /v1)" autocomplete="off" />
            <p class="field-hint">La dirección OpenAI-compatible de Ollama, LM Studio o tu LiteLLM.</p>
          </div>
          <div class="field">
            <label class="field-label">Clave de acceso <span class="muted" style="font-weight:400">(opcional)</span></label>
            <input v-model="form.generation.apiKey" type="password" autocomplete="off" :placeholder="apiKeySet ? '••• guardada' : 'Solo si tu servidor la pide'" />
          </div>
        </template>

        <!-- Conectar + traer modelos -->
        <div class="connect-row">
          <button class="btn primary" style="gap:6px" @click="connect" :disabled="connecting || !endpointReady">
            <Plug :size="15" :stroke-width="2" /> {{ connecting ? "Conectando…" : "Conectar y traer modelos" }}
          </button>
          <button v-if="models.length" class="btn ghost" @click="loadModels" :disabled="modelsLoading" title="Recargar modelos">
            <RefreshCw :size="14" :stroke-width="2" :class="{ 'spinning-slow': modelsLoading }" />
          </button>
          <span v-if="models.length" class="connected-pill"><CheckCheck :size="14" :stroke-width="2.5" /> {{ models.length }} modelos</span>
        </div>
        <div v-if="modelsError" class="models-error-banner">⚠ {{ modelsError }}</div>

        <!-- Modelo principal -->
        <div class="model-card">
          <div class="model-card-icon"><Sparkles :size="22" :stroke-width="1.8" /></div>
          <div class="model-card-body">
            <strong class="model-card-title">Modelo principal</strong>
            <p class="model-card-desc">Conversar, generar la app y documentar. El potente — debe soportar function-calling.</p>
            <select v-if="models.length" v-model="form.generation.mainModel">
              <option value="">— Selecciona un modelo —</option>
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="form.generation.mainModel && !models.includes(form.generation.mainModel)" :value="form.generation.mainModel">{{ form.generation.mainModel }}</option>
            </select>
            <input v-else v-model="form.generation.mainModel" placeholder="Ej: claude-sonnet-4-6 · deepseek-chat" />
          </div>
        </div>

        <!-- Modelo rápido -->
        <div class="model-card">
          <div class="model-card-icon"><Zap :size="22" :stroke-width="1.8" /></div>
          <div class="model-card-body">
            <strong class="model-card-title">Modelo rápido</strong>
            <p class="model-card-desc">Títulos y clasificación rápida. Puede ser uno más pequeño y barato.</p>
            <select v-if="models.length" v-model="form.generation.fastModel">
              <option value="">— Selecciona un modelo —</option>
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
              <option v-if="form.generation.fastModel && !models.includes(form.generation.fastModel)" :value="form.generation.fastModel">{{ form.generation.fastModel }}</option>
            </select>
            <input v-else v-model="form.generation.fastModel" placeholder="Ej: claude-haiku-4-5 · deepseek-chat" />
          </div>
        </div>

        <!-- Embeddings: fijo en local, no se configura -->
        <div class="model-card locked">
          <div class="model-card-icon emb"><Search :size="22" :stroke-width="1.8" /></div>
          <div class="model-card-body">
            <strong class="model-card-title">Búsqueda semántica <span class="auto-tag">automático</span></strong>
            <p class="model-card-desc">Siempre en tu equipo, sin configurar. Se descarga sola la primera vez.</p>
          </div>
          <div class="locked-pill"><Lock :size="13" :stroke-width="2" /> bge-m3 · local · 1024d</div>
        </div>

        <div class="step-actions">
          <button class="btn ghost" style="gap:5px" @click="currentStep = 0"><ChevronLeft :size="15" /> Anterior</button>
          <button class="btn primary" style="gap:5px" @click="save().then(() => currentStep = 2)">Guardar y comprobar <ChevronRight :size="15" /></button>
        </div>
      </div>

      <!-- Paso 2: Verificación -->
      <div v-show="currentStep === 2" class="step-body">
        <div class="step-header">
          <div class="step-header-icon"><CheckCircle :size="32" :stroke-width="1.5" /></div>
          <div>
            <h2>Comprobar la conexión</h2>
            <p class="muted">Vamos a asegurarnos de que todo funciona. La primera comprobación descarga el modelo de búsqueda (puede tardar un poco).</p>
          </div>
        </div>

        <button class="btn primary" @click="verify" :disabled="verifying" style="margin-bottom:20px; display:inline-flex; align-items:center; gap:7px">
          <Plug :size="15" :stroke-width="2" />
          {{ verifying ? "Comprobando…" : "Probar ahora" }}
        </button>

        <div v-if="verifyResults" class="verify-results">
          <div class="verify-row" v-for="key in ['provider', 'main', 'fast', 'tools', 'embeddings']" :key="key">
            <div class="verify-row-main">
              <span class="verify-dot" :class="verifyResults[key]?.ok ? 'ok' : 'error'" />
              <div class="verify-info">
                <strong class="verify-name">{{ verifyNames[key] }}</strong>
                <span class="verify-model dim">{{ verifyResults[key]?.model || '—' }}</span>
              </div>
              <span class="badge" :class="verifyResults[key]?.ok ? 'ok' : 'bad'">
                {{ verifyResults[key]?.ok ? 'OK' : 'Error' }}
              </span>
              <span class="dim" style="font-size:11px; min-width:60px; text-align:right">
                {{ verifyResults[key]?.responseMs ? verifyResults[key].responseMs + ' ms' : '—' }}
              </span>
            </div>
            <pre v-if="verifyResults[key]?.error" class="raw verify-error-inline">{{ verifyResults[key].error }}</pre>
          </div>
        </div>

        <div v-if="verifyError" class="badge bad" style="margin-top:10px">{{ verifyError }}</div>

        <div v-if="verifyResults && ['provider','main','fast'].every(k => verifyResults[k]?.ok)" class="success-banner">
          <CheckCheck :size="20" :stroke-width="2.5" /> ¡Todo listo! Puedes crear tu primer proyecto.
        </div>

        <div class="step-actions">
          <button class="btn ghost" style="gap:5px" @click="currentStep = 1"><ChevronLeft :size="15" /> Anterior</button>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.settings-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Sidebar ── */
.settings-sidebar {
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.settings-sidebar-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 14px;
}
.saved-notice  { font-size: 12px; color: var(--green);  margin-bottom: 8px; }
.error-notice  { font-size: 12px; color: var(--red);    margin-bottom: 8px; white-space: pre-wrap; }

.step-list { display: flex; flex-direction: column; gap: 4px; }
.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r);
  cursor: pointer;
  transition: background .12s;
  border-left: 3px solid transparent;
}
.step-item:hover { background: var(--bg-hover); }
.step-item.active { background: var(--accent-bg); border-left-color: var(--accent); }
.step-item.done   { border-left-color: var(--green); }
.step-item.error  { border-left-color: var(--red); }
.step-icon { display: flex; align-items: center; flex-shrink: 0; color: var(--text-muted); }
.step-item.active .step-icon { color: var(--accent); }
.step-item.done   .step-icon { color: var(--green); }
.step-text { flex: 1; display: flex; flex-direction: column; }
.step-text strong { font-size: 13px; color: var(--text); }
.step-status-label { font-size: 11px; color: var(--text-dim); }
.step-item.done   .step-status-label { color: var(--green); }
.step-item.active .step-text strong  { color: var(--accent); }
.step-check-icon { color: var(--green); flex-shrink: 0; }

/* ── Contenido ── */
.settings-content {
  overflow-y: auto;
  padding: 28px 32px;
  background: var(--bg);
}

.step-body { max-width: 640px; }

.step-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-dim);
}
.step-header-icon { display: flex; align-items: center; flex-shrink: 0; color: var(--accent); }
.step-header h2   { font-size: 20px; margin-bottom: 4px; }
.step-header p    { font-size: 14px; line-height: 1.6; }

.step-actions {
  display: flex;
  gap: 10px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border-dim);
}

/* ── Banner privacidad ── */
.privacy-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--green-bg);
  border: 1.5px solid var(--green-border);
  border-radius: var(--r);
  padding: 11px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  margin-bottom: 18px;
}
.privacy-banner svg { color: var(--green); flex-shrink: 0; margin-top: 1px; }

/* ── Modo nube/local ── */
.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.mode-card {
  text-align: left;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px 15px;
  cursor: pointer;
  transition: border-color .12s, background .12s;
}
.mode-card:hover { border-color: var(--accent-border); }
.mode-card.active { border-color: var(--accent); background: var(--accent-bg); }
.mode-card-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 5px;
}
.mode-card-head svg { color: var(--accent); }
.mode-card-sub { font-size: 12.5px; color: var(--text-muted); line-height: 1.4; }
.reco {
  font-size: 10.5px; font-weight: 600; color: var(--accent);
  background: var(--accent-bg); border: 1px solid var(--accent-border);
  padding: 1px 8px; border-radius: 20px; margin-left: auto;
}

/* ── Proveedor ── */
.section-label {
  display: block; font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
  color: var(--text-dim); margin-bottom: 8px;
}
.provider-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.provider-chip {
  font-size: 13px; color: var(--text-muted);
  background: var(--bg-surface); border: 1.5px solid var(--border);
  padding: 7px 14px; border-radius: 9px; cursor: pointer; transition: all .12s;
}
.provider-chip:hover { border-color: var(--accent-border); color: var(--text); }
.provider-chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }

.key-row { display: flex; align-items: center; gap: 8px; }
.key-row .key-icon { color: var(--text-muted); flex-shrink: 0; }
.key-row input { flex: 1; }

/* ── Conectar ── */
.connect-row { display: flex; align-items: center; gap: 10px; margin: 4px 0 16px; }
.connected-pill {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: var(--green);
  background: var(--green-bg); border: 1px solid var(--green-border);
  padding: 6px 12px; border-radius: 9px;
}

/* ── Model cards ── */
.model-card {
  display: flex;
  gap: 14px;
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  margin-bottom: 12px;
  align-items: flex-start;
  box-shadow: var(--shadow-sm);
}
.model-card.locked { border-style: dashed; align-items: center; opacity: 0.92; }
.model-card-icon { color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.model-card-icon.emb { color: var(--green); }
.model-card-body { flex: 1; }
.model-card-title { font-size: 14px; color: var(--text); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.model-card-desc  { font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 10px; }
.model-card.locked .model-card-desc { margin-bottom: 0; }
.auto-tag {
  font-size: 10.5px; font-weight: 600; color: var(--green);
  background: var(--green-bg); padding: 1px 8px; border-radius: 20px;
}
.locked-pill {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  font-size: 12px; font-family: var(--font-mono); color: var(--green);
  background: var(--green-bg); border: 1px solid var(--green-border);
  padding: 6px 11px; border-radius: 8px;
}

.models-error-banner {
  background: var(--accent-bg);
  border: 1.5px solid var(--accent-border);
  border-radius: var(--r);
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 14px;
}

/* ── Verify ── */
.verify-results {
  background: var(--bg-surface);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.verify-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-dim);
}
.verify-row:last-child { border-bottom: none; padding-bottom: 0; }
.verify-row-main { display: flex; align-items: center; gap: 10px; }
.verify-error-inline { margin: 0; font-size: 11px; color: var(--red); white-space: pre-wrap; word-break: break-all; }
.verify-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.verify-dot.ok    { background: var(--green); }
.verify-dot.error { background: var(--red); }
.verify-info { flex: 1; display: flex; flex-direction: column; }
.verify-name { font-size: 13px; font-weight: 600; color: var(--text); }
.verify-model { font-size: 11px; font-family: var(--font-mono); }

.success-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--green-bg);
  border: 1.5px solid var(--green-border);
  border-radius: var(--r-lg);
  padding: 16px 20px;
  font-size: 15px;
  font-weight: 700;
  color: var(--green);
  margin-bottom: 16px;
}
</style>
