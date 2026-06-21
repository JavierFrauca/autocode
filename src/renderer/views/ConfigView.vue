<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../api";
import { useAppStore } from "../stores";
import ModelSelect from "../components/ModelSelect.vue";

const app = useAppStore();

const form = reactive({
  litellm: { baseUrl: "", apiKey: "" },
  models: {
    chat: { model: "" },
    code: { model: "" },
    embeddings: { model: "", dim: 1024 },
    cheap: { model: "" },
  },
  projectsRoot: "",
  qdrantUrl: "http://127.0.0.1:6333",
  embeddingsBaseUrl: "",
});
const apiKeySet = ref(false);

const saving = ref<"" | "litellm" | "models" | "storage" | "all">("");
const savedAt = ref<string | null>(null);
const saveError = ref<string | null>(null);

const verifying = ref(false);
const verifyResults = ref<any>(null);
const verifyError = ref<string | null>(null);

const llmModels = ref<string[]>([]);
const embModels = ref<string[]>([]);
const loadingModels = ref(false);
const modelsError = ref<string | null>(null);

async function fetchModels() {
  if (!form.litellm.baseUrl) return;
  loadingModels.value = true;
  modelsError.value = null;
  try {
    const res = await api.availableModels();
    llmModels.value = res.litellm;
    embModels.value = res.embeddings.length ? res.embeddings : res.litellm;
  } catch (e: any) {
    modelsError.value = e?.message ?? String(e);
  } finally {
    loadingModels.value = false;
  }
}

async function load() {
  const cfg = await api.getConfig();
  form.litellm.baseUrl = cfg.litellm.baseUrl ?? "";
  apiKeySet.value = !!cfg.litellm.apiKeySet;
  form.litellm.apiKey = "";
  form.models.chat.model = cfg.models.chat.model ?? "";
  form.models.code.model = cfg.models.code.model ?? "";
  form.models.embeddings.model = cfg.models.embeddings.model ?? "";
  form.models.embeddings.dim = cfg.models.embeddings.dim ?? 1024;
  form.models.cheap.model = cfg.models.cheap.model ?? "";
  form.projectsRoot = cfg.projectsRoot ?? "";
  form.qdrantUrl = cfg.qdrantUrl ?? "http://127.0.0.1:6333";
  form.embeddingsBaseUrl = cfg.embeddingsBaseUrl ?? "";
}

async function save(section: "" | "litellm" | "models" | "storage" | "all" = "all") {
  saving.value = section || "all";
  saveError.value = null;
  try {
    await api.saveConfig(form);
    if (form.litellm.apiKey) apiKeySet.value = true;
    form.litellm.apiKey = "";
    savedAt.value = new Date().toLocaleTimeString();
    await app.refreshHealth();
    // Recargar lista de modelos si se guardó la sección de LiteLLM
    if (section === "litellm" || section === "all") await fetchModels();
  } catch (e: any) {
    saveError.value = e?.message ?? String(e);
  } finally {
    saving.value = "";
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

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const litellmStatus = computed<"full" | "partial" | "empty">(() => {
  const hasUrl = !!form.litellm.baseUrl;
  const hasKey = !!form.litellm.apiKey || apiKeySet.value;
  if (hasUrl && hasKey) return "full";
  if (hasUrl || hasKey) return "partial";
  return "empty";
});

const modelsStatus = computed<"full" | "partial" | "empty">(() => {
  const fields = [
    form.models.chat.model,
    form.models.code.model,
    form.models.embeddings.model,
    form.models.cheap.model,
  ];
  const filled = fields.filter(Boolean).length;
  const dimOk = form.models.embeddings.dim > 0;
  if (filled === 4 && dimOk) return "full";
  if (filled > 0 || dimOk) return "partial";
  return "empty";
});

const storageStatus = computed<"full" | "partial" | "empty">(() => {
  if (form.projectsRoot && form.qdrantUrl) return "full";
  if (form.projectsRoot || form.qdrantUrl) return "partial";
  return "empty";
});

const verifyStatus = computed<"full" | "partial" | "empty">(() => {
  if (!verifyResults.value) return "empty";
  const all = ["litellm", "chat", "code", "embeddings", "cheap"];
  const oks = all.filter((k) => verifyResults.value?.[k]?.ok).length;
  if (oks === all.length) return "full";
  if (oks > 0) return "partial";
  return "empty";
});

const overall = computed(() => {
  const steps = [litellmStatus.value, modelsStatus.value, storageStatus.value];
  const full = steps.filter((s) => s === "full").length;
  return Math.round((full / steps.length) * 100);
});

const steps = computed(() => [
  { id: "litellm", label: "LiteLLM", status: litellmStatus.value },
  { id: "models", label: "Modelos por rol", status: modelsStatus.value },
  { id: "storage", label: "Almacenamiento", status: storageStatus.value },
  { id: "verify", label: "Verificación", status: verifyStatus.value },
]);

function badgeFor(status: string) {
  if (status === "full") return "✓";
  if (status === "partial") return "·";
  return "○";
}

onMounted(async () => {
  await load();
  await fetchModels();
});
</script>

<template>
  <div class="cfg-shell">
    <!-- Stepper lateral -->
    <aside class="cfg-stepper">
      <div class="cfg-title">Configuración</div>
      <div class="cfg-progress">
        <div class="cfg-progress-bar"><div class="cfg-progress-fill" :style="{ width: overall + '%' }" /></div>
        <span class="dim mono" style="font-size: 11px">{{ overall }}% configurado</span>
      </div>

      <div class="cfg-steps">
        <div
          v-for="(s, i) in steps"
          :key="s.id"
          class="cfg-step"
          :class="s.status"
          @click="scrollTo(s.id)"
        >
          <span class="cfg-step-num">{{ badgeFor(s.status) }}</span>
          <div class="cfg-step-text">
            <strong>{{ i + 1 }}. {{ s.label }}</strong>
            <span class="dim" style="font-size: 11px">
              {{ s.status === "full" ? "completo" : s.status === "partial" ? "parcial" : "pendiente" }}
            </span>
          </div>
        </div>
      </div>

      <hr style="margin: 18px 0" />
      <button class="btn primary" style="width: 100%" @click="save('all')" :disabled="!!saving">
        {{ saving === 'all' ? "guardando…" : "Guardar todo" }}
      </button>
      <div v-if="savedAt" class="dim" style="font-size: 11px; text-align: center; margin-top: 6px">
        último guardado · {{ savedAt }}
      </div>
      <div v-if="saveError" class="badge bad" style="margin-top: 6px; text-align: center">{{ saveError }}</div>
    </aside>

    <!-- Contenido scrolleable -->
    <div class="cfg-scroll">
      <!-- 1. LiteLLM -->
      <section id="litellm" class="panel">
        <div class="panel-header">
          <span class="status" :class="litellmStatus === 'full' ? 'done' : litellmStatus === 'partial' ? 'pending' : 'failed'">{{ badgeFor(litellmStatus) }}</span>
          <strong>1 · LiteLLM</strong>
          <span class="muted right" style="font-size: 11px">la pasarela contra la que habla AutoCode</span>
        </div>
        <div class="panel-body">
          <div class="field">
            <label class="field-label">URL base</label>
            <input v-model="form.litellm.baseUrl" placeholder="https://tullm.com" autocomplete="off" />
            <p class="dim" style="font-size: 11px; margin-top: 4px">Sin /v1 al final — AutoCode lo añade automáticamente.</p>
          </div>
          <div class="field">
            <label class="field-label">API key</label>
            <input
              v-model="form.litellm.apiKey"
              type="password"
              autocomplete="off"
              :placeholder="apiKeySet ? '••• key configurada — déjalo vacío para mantenerla' : 'sk-...'"
            />
            <p v-if="apiKeySet && !form.litellm.apiKey" class="ok-text">
              ✓ hay una key guardada. si dejas el campo vacío, no se toca.
            </p>
            <p v-else-if="!apiKeySet" class="dim" style="font-size: 11px; margin-top: 4px">
              aún no hay key guardada.
            </p>
          </div>
          <button class="btn primary" @click="save('litellm')" :disabled="!!saving">
            {{ saving === 'litellm' ? "guardando…" : "Guardar esta sección" }}
          </button>
        </div>
      </section>

      <!-- 2. Modelos -->
      <section id="models" class="panel">
        <div class="panel-header">
          <span class="status" :class="modelsStatus === 'full' ? 'done' : modelsStatus === 'partial' ? 'pending' : 'failed'">{{ badgeFor(modelsStatus) }}</span>
          <strong>2 · Modelos por rol</strong>
          <span class="muted right" style="font-size: 11px">qué modelo usa cada parte de AutoCode</span>
        </div>
        <div class="panel-body">

          <!-- Estado de la lista de modelos -->
          <div class="models-status-bar">
            <template v-if="loadingModels">
              <span class="dim">cargando modelos de LiteLLM…</span>
            </template>
            <template v-else-if="modelsError">
              <span style="color: var(--red, #f85149)" title="Error al cargar modelos">⚠ {{ modelsError }}</span>
            </template>
            <template v-else-if="llmModels.length">
              <span class="ok-text">✓ {{ llmModels.length }} modelos disponibles</span>
            </template>
            <template v-else>
              <span class="dim">{{ form.litellm.baseUrl ? 'pulsa ↺ para cargar los modelos' : 'configura la URL de LiteLLM primero' }}</span>
            </template>
            <button class="btn-ghost" :disabled="loadingModels" @click="fetchModels" title="Recargar lista">
              ↺
            </button>
          </div>

          <div class="cfg-grid-2">
            <div class="field">
              <label class="field-label">chat <span class="dim">— diálogo con el usuario</span></label>
              <ModelSelect v-model="form.models.chat.model" :models="llmModels" />
            </div>
            <div class="field">
              <label class="field-label">code <span class="dim">— generación de la app objetivo</span></label>
              <ModelSelect v-model="form.models.code.model" :models="llmModels" />
            </div>
          </div>
          <div class="cfg-grid-3">
            <div class="field" style="grid-column: span 2">
              <label class="field-label">embeddings <span class="dim">— búsqueda semántica</span></label>
              <ModelSelect v-model="form.models.embeddings.model" :models="embModels" />
            </div>
            <div class="field">
              <label class="field-label">dim</label>
              <input v-model.number="form.models.embeddings.dim" type="number" min="1" />
            </div>
          </div>
          <div class="field">
            <label class="field-label">cheap <span class="dim">— clasificación, títulos, resúmenes cortos</span></label>
            <ModelSelect v-model="form.models.cheap.model" :models="llmModels" />
          </div>
          <div class="field">
            <label class="field-label">URL directa para embeddings <span class="dim">— opcional, bypasea LiteLLM</span></label>
            <input v-model="form.embeddingsBaseUrl" placeholder="http://192.168.1.38:11434  (vacío = usa LiteLLM)" autocomplete="off" @change="fetchModels" />
            <p class="dim" style="font-size: 11px; margin-top: 4px">
              Úsalo si LiteLLM no enruta bien los embeddings a Ollama. AutoCode llamará directamente a <code>/v1/embeddings</code> en esta URL.
            </p>
          </div>
          <button class="btn primary" @click="save('models')" :disabled="!!saving">
            {{ saving === 'models' ? "guardando…" : "Guardar esta sección" }}
          </button>
        </div>
      </section>

      <!-- 3. Almacenamiento -->
      <section id="storage" class="panel">
        <div class="panel-header">
          <span class="status" :class="storageStatus === 'full' ? 'done' : storageStatus === 'partial' ? 'pending' : 'failed'">{{ badgeFor(storageStatus) }}</span>
          <strong>3 · Almacenamiento</strong>
          <span class="muted right" style="font-size: 11px">dónde viven tus proyectos y la búsqueda</span>
        </div>
        <div class="panel-body">
          <div class="field">
            <label class="field-label">Carpeta raíz de proyectos</label>
            <input v-model="form.projectsRoot" placeholder="C:\AutoCodeProjects" />
            <p class="dim" style="font-size: 11px; margin-top: 4px">
              Cada proyecto creará su subcarpeta aquí dentro.
            </p>
          </div>
          <div class="field">
            <label class="field-label">Qdrant URL</label>
            <input v-model="form.qdrantUrl" />
            <p class="dim" style="font-size: 11px; margin-top: 4px">
              Si lo dejas en localhost, AutoCode lo lanza solo al arrancar.
            </p>
          </div>
          <button class="btn primary" @click="save('storage')" :disabled="!!saving">
            {{ saving === 'storage' ? "guardando…" : "Guardar esta sección" }}
          </button>
        </div>
      </section>

      <!-- 4. Verificación -->
      <section id="verify" class="panel">
        <div class="panel-header">
          <span class="status" :class="verifyStatus === 'full' ? 'done' : verifyStatus === 'partial' ? 'pending' : 'failed'">{{ badgeFor(verifyStatus) }}</span>
          <strong>4 · Verificación</strong>
          <span class="muted right" style="font-size: 11px">comprobar que todo responde de verdad</span>
        </div>
        <div class="panel-body">
          <p class="muted" style="margin-bottom: 12px">
            Hace ping a LiteLLM y una llamada mínima a cada modelo. Para embeddings comprueba además que la dimensión devuelta coincide con la configurada.
          </p>

          <table v-if="verifyResults" class="verify-tbl">
            <thead>
              <tr>
                <th style="width: 110px">Pieza</th>
                <th>Modelo</th>
                <th style="width: 90px">Estado</th>
                <th style="width: 100px; text-align: right">Tiempo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>litellm</strong></td>
                <td class="dim">—</td>
                <td><span class="badge" :class="verifyResults.litellm.ok ? 'ok' : 'bad'">{{ verifyResults.litellm.ok ? 'OK' : 'FAIL' }}</span></td>
                <td class="mono right">{{ verifyResults.litellm.responseMs }} ms</td>
              </tr>
              <tr v-if="verifyResults.litellm?.error">
                <td colspan="4" class="verify-error-cell"><pre class="raw">{{ verifyResults.litellm.error }}</pre></td>
              </tr>
              <template v-for="role in ['chat', 'code', 'embeddings', 'cheap']" :key="role">
                <tr>
                  <td><strong>{{ role }}</strong></td>
                  <td class="mono">
                    {{ verifyResults[role].model || '—' }}
                    <span v-if="role === 'embeddings' && verifyResults[role].dim" class="dim">
                      · dim {{ verifyResults[role].dim }}{{ verifyResults[role].dim !== verifyResults[role].expectedDim ? ' ≠ ' + verifyResults[role].expectedDim : '' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" :class="verifyResults[role].ok ? 'ok' : 'bad'">{{ verifyResults[role].ok ? 'OK' : 'FAIL' }}</span>
                  </td>
                  <td class="mono right">{{ verifyResults[role].responseMs }} ms</td>
                </tr>
                <tr v-if="verifyResults[role]?.error">
                  <td colspan="4" class="verify-error-cell"><pre class="raw">{{ verifyResults[role].error }}</pre></td>
                </tr>
              </template>
            </tbody>
          </table>

          <details v-if="verifyResults?.litellm?.availableModels?.length" style="margin-top: 8px">
            <summary class="dim" style="font-size: 11px; cursor: pointer">
              {{ verifyResults.litellm.availableModels.length }} modelos disponibles en LiteLLM
            </summary>
            <div class="available-models">
              <code v-for="m in verifyResults.litellm.availableModels" :key="m">{{ m }}</code>
            </div>
          </details>

          <div v-if="verifyError" class="badge bad" style="margin-top: 8px">{{ verifyError }}</div>

          <button class="btn primary" @click="verify" :disabled="verifying" style="margin-top: 14px">
            {{ verifying ? "comprobando…" : "Comprobar todo ahora" }}
          </button>
        </div>
      </section>

      <div style="height: 40px" />
    </div>
  </div>
</template>

<style scoped>
.cfg-shell {
  display: grid;
  grid-template-columns: 260px 1fr;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.cfg-stepper {
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.cfg-title {
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 12px;
  color: var(--text);
}

.cfg-progress { margin-bottom: 14px; }
.cfg-progress-bar {
  height: 4px;
  background: var(--bg-active);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
}
.cfg-progress-fill {
  height: 100%;
  background: var(--cyan);
  transition: width 0.3s ease;
}

.cfg-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cfg-step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
  border-left: 2px solid transparent;
}
.cfg-step:hover { background: var(--bg-hover); }
.cfg-step.full { border-left-color: var(--green); }
.cfg-step.partial { border-left-color: var(--yellow); }
.cfg-step.empty { border-left-color: var(--border); }

.cfg-step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.cfg-step.full .cfg-step-num { background: var(--green-dim); color: white; }
.cfg-step.partial .cfg-step-num { background: var(--yellow); color: #000; }
.cfg-step.empty .cfg-step-num { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }
.cfg-step-text { display: flex; flex-direction: column; line-height: 1.2; }

.cfg-scroll {
  overflow-y: auto;
  padding: 20px 24px;
}

.cfg-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cfg-grid-3 { display: grid; grid-template-columns: 1fr 1fr 0.5fr; gap: 12px; }

.ok-text {
  color: var(--green);
  font-size: 11px;
  margin-top: 4px;
}

.verify-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.verify-tbl th,
.verify-tbl td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border-dim);
  text-align: left;
  vertical-align: middle;
}
.verify-tbl th {
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border);
}
.verify-tbl .right { text-align: right; }
.verify-error-cell { padding: 2px 10px 8px !important; }
.verify-error-cell pre { margin: 0; font-size: 11px; color: var(--red); white-space: pre-wrap; word-break: break-all; }

.available-models {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 0;
}
.available-models code {
  background: var(--bg-active);
  border: 1px solid var(--border-dim);
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--cyan);
}

.models-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 11px;
}

.btn-ghost {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px 7px;
}
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.btn-ghost:disabled { opacity: 0.4; cursor: default; }
</style>
