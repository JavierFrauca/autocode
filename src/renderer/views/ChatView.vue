<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, chatStream, formatDbDate } from "../api";
import { renderMarkdown } from "../md";
import { useAppStore } from "../stores";
import { Pencil, Paperclip, Link as LinkIcon, FileCog, X } from "lucide-vue-next";
import logoLight from "../assets/logo-light.png";
import logoDark  from "../assets/logo-dark.png";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const projectId = computed(() => route.params.projectId as string);
const sessionId = ref<string | null>(null);
const messages = ref<any[]>([]);
const input = ref("");
const sending = ref(false);
const streamingContent = ref("");
const pendingDocRunId = ref<string | null>(null);
const msgsEl = ref<HTMLElement | null>(null);
const sessions = ref<any[]>([]);
const editingSessionId = ref<string | null>(null);
const editingTitle = ref("");
const renameInputEl = ref<HTMLInputElement | null>(null);
const headerEditing = ref(false);
const headerEditTitle = ref("");
const headerInputEl = ref<HTMLInputElement | null>(null);

// ── Fases de streaming ─────────────────────────────────────────────────────
const phase = ref<string | null>(null);
const phaseStart = ref(0);
const phaseElapsed = ref(0);
const streamingTokens = ref(0);
let phaseTimer: any = null;
let firstDeltaAt: number | null = null;

const PRE_DELTA: { after: number; text: string }[] = [
  { after: 0,      text: "Conectando con la IA…" },
  { after: 2000,   text: "Esperando respuesta…" },
  { after: 8000,   text: "El modelo está cargando, un momento…" },
  { after: 20000,  text: "Sigue arrancando, ten paciencia…" },
  { after: 45000,  text: "Casi listo, no cierres la ventana…" },
];
const POST_DELTA: { after: number; text: string }[] = [
  { after: 0,    text: "Escribiendo la respuesta…" },
  { after: 1500, text: "Completando…" },
];

function pickPhase(ms: number, table: typeof PRE_DELTA) {
  let r = table[0]!.text;
  for (const p of table) { if (ms >= p.after) r = p.text; else break; }
  return r;
}
function startPhase() {
  phaseStart.value = Date.now();
  firstDeltaAt = null;
  phaseElapsed.value = 0;
  streamingTokens.value = 0;
  phase.value = PRE_DELTA[0]!.text;
  phaseTimer = setInterval(() => {
    const now = Date.now();
    phaseElapsed.value = now - phaseStart.value;
    phase.value = firstDeltaAt
      ? pickPhase(now - firstDeltaAt, POST_DELTA)
      : pickPhase(phaseElapsed.value, PRE_DELTA);
  }, 400);
}
function stopPhase() {
  if (phaseTimer) clearInterval(phaseTimer);
  phaseTimer = null;
  phase.value = null;
  firstDeltaAt = null;
}
onBeforeUnmount(stopPhase);

// ── Sesiones ────────────────────────────────────────────────────────────────
const currentSession = computed(() => sessions.value.find((s) => s.id === sessionId.value) ?? null);
const sessionLabel = (s: any) => s?.title || formatDbDate(s?.createdAt, "Nueva conversación");

async function loadSessions() {
  sessions.value = await api.sessions(projectId.value);
  if (sessions.value.length === 0) {
    const s = await api.createSession(projectId.value);
    sessions.value = [s];
  }
  sessionId.value = sessions.value[0].id;
  await loadMessages();
}

async function loadMessages() {
  if (!sessionId.value) return;
  messages.value = await api.messages(sessionId.value);
  await scroll();
  loadScope();
}

// Cobertura del alcance (motor de completitud): cuánto falta por definir. Se refresca al cargar la
// conversación y tras cada respuesta del asistente (los papers nuevos cambian la cobertura).
const scope = ref<{
  items: { key: string; label: string; status: "ok" | "partial" | "missing"; detail: string }[];
  coverage: number;
  closed: boolean;
} | null>(null);
const scopeOpen = ref(false);
async function loadScope() {
  if (!projectId.value) return;
  try { scope.value = await api.getScope(projectId.value); } catch { /* best-effort */ }
}

// ── Previews de pantalla embebidas en el chat ────────────────────────────────
// Cuando el documenter crea/actualiza una pantalla en un turno, el servidor la devuelve en
// `metadata.screens`. Cargamos su boceto (el `html` que ya expone `listScreens`) para mostrarlo en
// línea. La maqueta se genera de forma SÍNCRONA dentro del turno (el servidor espera a que exista
// antes de responder), así que normalmente ya está lista a la primera; el reintento es solo un
// colchón defensivo (lag de índice, o si el servidor tardó más de lo normal).
const screenPreviews = ref<Record<string, { html: string | null; loading: boolean }>>({});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function screenSlugOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
function screenName(path: string): string {
  return screenSlugOf(path).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadScreenPreview(path: string, tries = 5): Promise<void> {
  if (!projectId.value) return;
  if (screenPreviews.value[path]?.html) return;
  screenPreviews.value = { ...screenPreviews.value, [path]: { html: screenPreviews.value[path]?.html ?? null, loading: true } };
  const slug = screenSlugOf(path);
  for (let i = 0; i < tries; i++) {
    try {
      const r = await api.listScreens(projectId.value);
      const s = r.screens.find((x) => x.path === path || x.slug === slug);
      if (s?.html) {
        screenPreviews.value = { ...screenPreviews.value, [path]: { html: s.html, loading: false } };
        return;
      }
    } catch { /* reintentamos */ }
    await sleep(1500);
  }
  screenPreviews.value = { ...screenPreviews.value, [path]: { html: screenPreviews.value[path]?.html ?? null, loading: false } };
}

function messageScreens(m: any): string[] {
  const s = m?.metadata?.screens;
  return Array.isArray(s) ? s : [];
}
function openScreenInEditor(path: string): void {
  router.push(`/projects/${projectId.value}/screens?slug=${encodeURIComponent(screenSlugOf(path))}`);
}

// Carga los bocetos de las pantallas que aparezcan en los mensajes (turno nuevo o historial).
watch(messages, (list) => {
  for (const m of list) for (const p of messageScreens(m)) loadScreenPreview(p);
}, { deep: true });

async function selectSession(id: string) {
  sessionId.value = id;
  pendingDocRunId.value = null;
  await loadMessages();
}

async function newSession() {
  const s = await api.createSession(projectId.value);
  sessions.value.unshift(s);
  sessionId.value = s.id;
  messages.value = [];
  pendingDocRunId.value = null;
}

async function scroll() {
  await nextTick();
  if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight;
}

// ── Envío ──────────────────────────────────────────────────────────────────
async function send() {
  if (!input.value.trim() || !sessionId.value || sending.value) return;
  const content = input.value.trim();
  input.value = "";
  sending.value = true;
  streamingContent.value = "";
  const optimistic = { id: `tmp_${Date.now()}`, role: "user", content };
  messages.value.push(optimistic);
  await scroll();
  startPhase();

  let sawError = false;
  let serverConfirmedUser = false;

  try {
    for await (const ev of chatStream(projectId.value, sessionId.value, content)) {
      if (ev.event === "open") {
        // el servidor ya abrió el stream: la conexión está viva, aunque el modelo tarde
      } else if (ev.event === "duplicate") {
        // reenvío de la misma petición: el servidor lo ignoró. Quitamos el optimista y salimos.
        messages.value = messages.value.filter((m) => m.id !== optimistic.id);
        serverConfirmedUser = true;
      } else if (ev.event === "user") {
        const idx = messages.value.findIndex((m) => m.id === optimistic.id);
        if (idx >= 0) messages.value[idx] = { id: ev.data.id, role: "user", content: ev.data.content };
        serverConfirmedUser = true;
        await scroll();
      } else if (ev.event === "delta") {
        if (!firstDeltaAt) firstDeltaAt = Date.now();
        streamingContent.value += ev.data.text;
        streamingTokens.value += 1;
        await scroll();
      } else if (ev.event === "assistant") {
        messages.value.push({
          id: ev.data.id,
          role: "assistant",
          content: ev.data.content,
          metadata: ev.data,
        });
        streamingContent.value = "";
        pendingDocRunId.value = ev.data.documenterRunId ?? null;
        await scroll();
        // Auto-título: si la sesión no tiene nombre aún, pedirlo al LLM (fire-and-forget)
        const _sid = sessionId.value;
        const _sess = sessions.value.find((s) => s.id === _sid);
        if (_sid && !_sess?.title) {
          api.suggestSessionTitle(_sid).then((r) => {
            if (r?.title) {
              const i = sessions.value.findIndex((s) => s.id === _sid);
              if (i >= 0) sessions.value[i] = { ...sessions.value[i], title: r.title };
            }
          }).catch(() => {});
        }
      } else if (ev.event === "notice") {
        // El servidor reanudó la construcción a partir de este mensaje (lazo de "necesito tu ayuda").
        messages.value.push({
          id: ev.data.id,
          role: "assistant",
          content: ev.data.content,
          metadata: { kind: "executor-retry" },
        });
        await scroll();
      } else if (ev.event === "error") {
        sawError = true;
        if (!serverConfirmedUser) {
          messages.value = messages.value.filter((m) => m.id !== optimistic.id);
          input.value = content;
        }
        messages.value.push({
          id: `err_${Date.now()}`,
          role: "system",
          content: ev.data?.message ?? (typeof ev.data === "string" ? ev.data : "Algo falló al responder."),
        });
        await scroll();
      }
    }
    if (!sawError) {
      setTimeout(async () => {
        sessions.value = await api.sessions(projectId.value);
      }, 1200);
    }
  } catch (e: any) {
    if (!serverConfirmedUser) {
      messages.value = messages.value.filter((m) => m.id !== optimistic.id);
      input.value = content;
    }
    messages.value.push({
      id: `err_${Date.now()}`,
      role: "system",
      content: `Se interrumpió la conexión con el servidor (${e?.message ?? e}). Reintenta el envío.`,
    });
    await scroll();
  } finally {
    stopPhase();
    sending.value = false;
    loadScope();
  }
}

// Ejemplos para arrancar: un clic los envía. Desbloquean a quien se queda en blanco ante el chat.
const EXAMPLES = [
  "Tengo una clínica y quiero gestionar las citas de los pacientes",
  "Quiero una app para llevar el inventario y las ventas de mi tienda",
  "Necesito controlar pedidos, clientes y albaranes de mi empresa",
  "Una herramienta para reservar salas y material de la oficina",
];
async function sendExample(text: string) {
  if (sending.value) return;
  input.value = text;
  await send();
}

function goToDocs() {
  router.push(`/projects/${projectId.value}/docs`);
}

// ── Adjuntos (fichero / URL) ─────────────────────────────────────────────────
const fileInputEl = ref<HTMLInputElement | null>(null);
const attaching = ref(false);
const urlMode = ref(false);
const urlInput = ref("");
// Cuando está activo, el siguiente adjunto (fichero o URL) se registra como DOCUMENTO TÉCNICO
// (fuente canónica destilada a paper DT-NNN), no como referencia genérica.
const techMode = ref(false);

function pushNote(content: string, error = false) {
  messages.value.push({ id: `att_${Date.now()}`, role: error ? "system" : "assistant", content });
  scroll();
}

function pickFile() { fileInputEl.value?.click(); }

async function onFilePicked(e: Event) {
  const el = e.target as HTMLInputElement;
  const f = el.files?.[0];
  el.value = "";
  if (!f) return;
  attaching.value = true;
  try {
    const r = await api.attachFile(projectId.value, f, { tecnico: techMode.value });
    pushNote(
      r.kind === "resource"
        ? `📎 He guardado **${r.name}** en Recursos — lo usaré en el diseño de la app.`
        : r.kind === "technical"
          ? `📐 He registrado **${r.name}** como documento técnico — lo seguiré al pie de la letra al construir la app.`
          : `📎 He guardado **${r.name}** en Documentos — lo tendré en cuenta como referencia.`,
    );
    techMode.value = false;
  } catch (err: any) {
    pushNote(`No pude adjuntar el archivo: ${err?.message ?? err}`, true);
  } finally {
    attaching.value = false;
  }
}

async function submitUrl() {
  const url = urlInput.value.trim();
  if (!url || attaching.value) return;
  attaching.value = true;
  try {
    const r = await api.attachUrl(projectId.value, url, { tecnico: techMode.value });
    pushNote(
      r.kind === "technical"
        ? `📐 He descargado **${r.name}** y lo registré como documento técnico — lo seguiré al pie de la letra al construir la app.`
        : `🔗 He revisado **${r.name}** y guardé las conclusiones en Documentos.`,
    );
    urlInput.value = "";
    urlMode.value = false;
    techMode.value = false;
  } catch (err: any) {
    pushNote(`No pude abrir el enlace: ${err?.message ?? err}`, true);
  } finally {
    attaching.value = false;
  }
}

// ── Renombrado de sesiones ──────────────────────────────────────────────────
function startRename(s: any, ev: Event) {
  ev.stopPropagation();
  editingSessionId.value = s.id;
  editingTitle.value = s.title ?? "";
  nextTick(() => { renameInputEl.value?.select(); });
}

async function saveRename() {
  if (!editingSessionId.value) return;
  const id = editingSessionId.value;
  editingSessionId.value = null;
  const title = editingTitle.value.trim() || null;
  await api.renameSession(id, title);
  const idx = sessions.value.findIndex((s) => s.id === id);
  if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], title };
}

function cancelRename() {
  editingSessionId.value = null;
}

function startHeaderRename() {
  headerEditTitle.value = currentSession.value?.title ?? "";
  headerEditing.value = true;
  nextTick(() => { headerInputEl.value?.select(); });
}

async function saveHeaderRename() {
  if (!headerEditing.value || !sessionId.value) return;
  headerEditing.value = false;
  const title = headerEditTitle.value.trim() || null;
  await api.renameSession(sessionId.value, title);
  const idx = sessions.value.findIndex((s) => s.id === sessionId.value);
  if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], title };
}

function cancelHeaderRename() {
  headerEditing.value = false;
}

onMounted(loadSessions);
watch(projectId, loadSessions);
</script>

<template>
  <div class="chat-layout">
    <!-- Sidebar de sesiones -->
    <aside class="conv-sidebar">
      <div class="conv-sidebar-title">Conversaciones</div>
      <button class="conv-new-btn" @click="newSession">+ Nueva conversación</button>

      <div class="conv-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="conv-item"
          :class="{ active: s.id === sessionId }"
          @click="editingSessionId !== s.id && selectSession(s.id)"
        >
          <div class="conv-item-name" @dblclick.stop="startRename(s, $event)" :title="'Doble clic para renombrar'">
            <input
              v-if="editingSessionId === s.id"
              ref="renameInputEl"
              class="conv-rename-input"
              v-model="editingTitle"
              @keydown.enter.stop.prevent="saveRename"
              @keydown.escape.stop="cancelRename"
              @blur="saveRename"
              @click.stop
            />
            <span v-else>{{ sessionLabel(s) }}</span>
          </div>
          <div class="conv-item-date">{{ formatDbDate(s.createdAt, "") }}</div>
        </div>
        <div v-if="sessions.length === 0" class="conv-empty">No hay conversaciones</div>
      </div>
    </aside>

    <!-- Área de chat -->
    <div class="chat-main">
      <!-- Logo de fondo / marca de agua -->
      <img
        :src="app.theme === 'dark' ? logoDark : logoLight"
        class="chat-bg-logo"
        aria-hidden="true"
      />

      <!-- Header de la sesión activa -->
      <div class="chat-header">
        <div class="chat-title-wrap">
          <input
            v-if="headerEditing"
            ref="headerInputEl"
            class="chat-session-input"
            v-model="headerEditTitle"
            @keydown.enter.stop.prevent="saveHeaderRename"
            @keydown.escape.stop="cancelHeaderRename"
            @blur="saveHeaderRename"
          />
          <template v-else>
            <span class="chat-session-name">{{ sessionLabel(currentSession) }}</span>
            <button class="chat-rename-btn" title="Renombrar conversación" @click="startHeaderRename">
              <Pencil :size="13" :stroke-width="2.5" />
            </button>
          </template>
        </div>
        <span v-if="pendingDocRunId" class="badge info" style="cursor:pointer" @click="goToDocs">
          Documento actualizado → ver
        </span>
        <span v-if="phase" class="phase-chip">
          <span class="phase-dot-sm" />{{ phase }}
        </span>
        <button
          v-if="scope"
          class="scope-chip"
          :class="{ done: scope.closed }"
          :title="scope.closed ? 'Ya está todo definido' : 'Cuánto llevas definido — clic para ver el detalle'"
          @click="scopeOpen = !scopeOpen"
        >
          <span class="scope-track"><span class="scope-fill" :style="{ width: Math.round(scope.coverage * 100) + '%' }" /></span>
          {{ scope.closed ? 'Definido ✓' : 'Definido ' + Math.round(scope.coverage * 100) + '%' }}
          <span class="scope-caret" :class="{ open: scopeOpen }">⌄</span>
        </button>
      </div>

      <!-- Detalle de cobertura del alcance (motor de completitud) -->
      <div v-if="scope && scopeOpen" class="scope-panel">
        <div class="scope-head">
          {{ scope.closed
            ? 'Ya está todo lo esencial definido.'
            : 'Vamos por el ' + Math.round(scope.coverage * 100) + '% — esto es lo que queda por hablar:' }}
        </div>
        <div v-for="it in scope.items" :key="it.key" class="scope-item">
          <span class="scope-ico" :class="it.status">{{ it.status === 'ok' ? '✓' : it.status === 'partial' ? '◐' : '○' }}</span>
          <span class="scope-lbl">{{ it.label }}</span>
          <span class="scope-detail">{{ it.detail }}</span>
        </div>
      </div>

      <!-- Mensajes -->
      <div class="msgs" ref="msgsEl">
        <!-- Empty state -->
        <div v-if="messages.length === 0 && !streamingContent && !phase" class="chat-empty">
          <img :src="app.theme === 'dark' ? logoDark : logoLight" class="chat-empty-logo" alt="" />
          <h3>Cuéntame qué quieres construir</h3>
          <p class="muted">Describe tu negocio, una pantalla o una regla. La IA irá generando los documentos del proyecto automáticamente.</p>
          <div class="chat-examples">
            <span class="chat-examples-label">¿No sabes por dónde empezar? Pulsa un ejemplo:</span>
            <button v-for="ex in EXAMPLES" :key="ex" class="example-chip" :disabled="sending" @click="sendExample(ex)">
              {{ ex }}
            </button>
          </div>
        </div>

        <!-- Mensajes -->
        <template v-for="m in messages" :key="m.id">
          <!-- Usuario -->
          <div v-if="m.role === 'user'" class="msg-user-wrap">
            <div class="msg-user">{{ m.content }}</div>
          </div>

          <!-- Asistente con markdown renderizado -->
          <div v-else-if="m.role === 'assistant'" class="msg-ai-wrap">
            <div class="msg-ai-label">
              <span class="msg-ai-avatar" />
              AutoCode
            </div>
            <div class="msg-ai markdown" v-html="renderMarkdown(m.content)" />
            <div v-if="m.metadata?.documenterRunId" class="doc-chips-row">
              <a class="doc-chip" @click.prevent="goToDocs">
                📄 Ver documento actualizado →
              </a>
            </div>
            <!-- Bocetos de las pantallas trabajadas en este turno (ver mientras se habla) -->
            <div v-if="messageScreens(m).length" class="screen-previews">
              <div v-for="p in messageScreens(m)" :key="p" class="screen-card">
                <div class="screen-card-head">
                  <span class="screen-card-title">🖥️ {{ screenName(p) }}</span>
                  <a class="screen-card-edit" @click.prevent="openScreenInEditor(p)">Abrir para editar →</a>
                </div>
                <iframe
                  v-if="screenPreviews[p]?.html"
                  class="screen-card-frame"
                  sandbox=""
                  :srcdoc="screenPreviews[p].html ?? ''"
                />
                <div v-else class="screen-card-empty">
                  {{ screenPreviews[p]?.loading ? 'Generando el boceto…' : 'Boceto no disponible todavía.' }}
                </div>
              </div>
              <div class="screen-hint">¿Hay que cambiar algo? Dímelo por el chat y lo actualizo.</div>
            </div>
          </div>

          <!-- Sistema (errores) -->
          <div v-else-if="m.role === 'system'" class="msg-system">
            ⚠ {{ m.content }}
          </div>
        </template>

        <!-- Streaming -->
        <div v-if="streamingContent" class="msg-ai-wrap">
          <div class="msg-ai-label">
            <span class="msg-ai-avatar" />
            AutoCode
            <span class="phase-chip-inline" v-if="phase">
              <span class="phase-dot-sm" />{{ phase }}
            </span>
          </div>
          <div class="msg-ai markdown" v-html="renderMarkdown(streamingContent)" />
        </div>

        <!-- Fase de espera -->
        <div v-else-if="phase" class="phase-wrap">
          <span class="phase-dot" />
          <span class="phase-text">{{ phase }}</span>
          <span class="phase-elapsed">{{ Math.floor(phaseElapsed / 1000) }}s</span>
        </div>
      </div>

      <!-- Input -->
      <div class="chat-input">
        <input
          ref="fileInputEl" type="file" style="display:none" @change="onFilePicked"
          accept=".md,.txt,.xml,.xsd,.json,.csv,.yaml,.yml,.html,.pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.ico"
        />
        <div v-if="urlMode" class="attach-url-row">
          <LinkIcon :size="15" :stroke-width="2" style="color:var(--text-dim); flex-shrink:0" />
          <input
            v-model="urlInput" class="attach-url-input"
            :placeholder="techMode ? 'Pega la URL de descarga de la especificación técnica' : 'Pega un enlace (https://…) y lo reviso'"
            :disabled="attaching" @keydown.enter.prevent="submitUrl"
          />
          <button class="btn primary" style="padding:6px 14px" :disabled="attaching || !urlInput.trim()" @click="submitUrl">
            {{ attaching ? "…" : "Añadir" }}
          </button>
          <button class="attach-btn" title="Cerrar" @click="urlMode = false"><X :size="16" /></button>
        </div>
        <div class="chat-input-row">
          <button class="attach-btn" title="Adjuntar un archivo" :disabled="attaching || sending" @click="pickFile">
            <Paperclip :size="18" :stroke-width="2" />
          </button>
          <button class="attach-btn" :class="{ on: urlMode }" title="Adjuntar un enlace" :disabled="attaching || sending" @click="urlMode = !urlMode">
            <LinkIcon :size="18" :stroke-width="2" />
          </button>
          <button
            class="attach-btn" :class="{ on: techMode }"
            :title="techMode ? 'El siguiente adjunto se registrará como documento técnico (fuente oficial)' : 'Marcar el siguiente adjunto como documento técnico (formato/norma/esquema oficial)'"
            :disabled="attaching || sending" @click="techMode = !techMode"
          >
            <FileCog :size="18" :stroke-width="2" />
          </button>
          <textarea
            v-model="input"
            :disabled="sending"
            @keydown.enter.exact.prevent="send"
            placeholder="Escribe… (Enter envía, Shift+Enter salto de línea)"
            rows="2"
          />
          <button class="btn primary" @click="send" :disabled="sending" style="align-self:flex-end; padding:10px 20px">
            {{ sending ? "…" : "Enviar →" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

/* ── Sidebar de sesiones ─── */
.conv-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.conv-sidebar-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-dim);
  padding: 14px 14px 8px;
  border-bottom: 1px solid var(--border-dim);
  flex-shrink: 0;
}
.conv-new-btn {
  margin: 10px 10px 6px;
  padding: 8px 12px;
  background: var(--accent-bg);
  border: 1.5px dashed var(--accent-border);
  border-radius: var(--r);
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background .12s;
  font-family: inherit;
}
.conv-new-btn:hover { background: #DDD6FE; }

.conv-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
.conv-item {
  padding: 9px 10px;
  border-radius: var(--r);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background .1s;
}
.conv-item:hover { background: var(--bg-hover); }
.conv-item.active { background: var(--accent-bg); }
.conv-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}
.conv-rename-input {
  width: 100%;
  padding: 1px 0;
  background: transparent;
  border: none;
  border-bottom: 1.5px solid var(--accent);
  outline: none;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.4;
  cursor: text;
}
.conv-item.active .conv-item-name { color: var(--accent); }
.conv-item-date { font-size: 11px; color: var(--text-dim); margin-top: 1px; }
.conv-empty { font-size: 12px; color: var(--text-dim); padding: 12px 10px; }

/* ── Chat principal ─── */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-surface);
  position: relative;
}

/* Logo de fondo: sutil marca de agua en la esquina inferior derecha */
.chat-bg-logo {
  position: absolute;
  bottom: 72px;     /* por encima del input */
  right: 28px;
  width: 220px;
  height: auto;
  opacity: 0.045;
  pointer-events: none;
  user-select: none;
  z-index: 0;
  mix-blend-mode: normal;
}

/* Logo prominente en el empty state */
.chat-empty-logo {
  width: 180px;
  height: auto;
  opacity: 0.18;
  margin-bottom: 4px;
  pointer-events: none;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
  min-height: 48px;
  flex-wrap: wrap;
}
.chat-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.chat-session-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
.chat-rename-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--text-dim);
  cursor: pointer;
  padding: 3px 4px;
  opacity: 0;
  transition: opacity .15s, color .15s, background .15s;
  flex-shrink: 0;
}
.chat-title-wrap:hover .chat-rename-btn { opacity: 1; }
.chat-rename-btn:hover { color: var(--accent); background: var(--accent-bg); }
.chat-session-input {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  background: transparent;
  border: none;
  border-bottom: 1.5px solid var(--accent);
  outline: none;
  padding: 1px 0;
  font-family: inherit;
  min-width: 180px;
  max-width: 420px;
}

.phase-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}
.scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  background: var(--accent-bg);
  border: 1px solid var(--accent-border);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
  cursor: pointer;
}
.scope-chip.done { color: #16a34a; border-color: rgba(22,163,74,.4); }
.scope-track { width: 48px; height: 5px; border-radius: 3px; background: var(--bg-active); overflow: hidden; }
.scope-fill { display: block; height: 100%; background: currentColor; border-radius: 3px; transition: width .3s ease; }
.scope-caret { font-size: 12px; line-height: 1; transition: transform .2s ease; opacity: .8; }
.scope-caret.open { transform: rotate(180deg); }
.scope-panel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12px;
}
.scope-head { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.scope-item { display: flex; align-items: center; gap: 8px; }
.scope-ico { width: 16px; text-align: center; font-size: 13px; }
.scope-ico.ok { color: #16a34a; }
.scope-ico.partial { color: #d9a21b; }
.scope-ico.missing { color: var(--text-dim); }
.scope-lbl { font-weight: 500; min-width: 150px; }
.scope-detail { color: var(--text-muted); font-size: 11px; }
.screen-previews { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.screen-card {
  width: 320px;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elevated);
}
.screen-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.screen-card-title { font-weight: 500; }
.screen-card-edit { color: var(--accent); cursor: pointer; font-size: 11px; white-space: nowrap; }
.screen-card-frame { width: 100%; height: 220px; border: 0; background: #fff; display: block; }
.screen-card-empty {
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
}
.screen-hint { flex-basis: 100%; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.phase-chip-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--accent);
  margin-left: 8px;
  font-weight: 500;
}
.phase-dot-sm {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: phasePulse 1.1s ease-in-out infinite;
}
@keyframes phasePulse {
  0%,100% { transform: scale(1); opacity:1; }
  50%      { transform: scale(1.5); opacity:.5; }
}

/* Empty state del chat */
.chat-empty {
  text-align: center;
  padding: 48px 24px 60px;
  margin: auto;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}
.chat-empty h3 { font-size: 17px; color: var(--text); margin: 0; }
.chat-empty p  { font-size: 14px; line-height: 1.65; }

/* Ejemplos clicables para arrancar */
.chat-examples { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; width: 100%; }
.chat-examples-label { font-size: 12.5px; color: var(--text-dim); margin-bottom: 2px; }
.example-chip {
  text-align: left; font-family: inherit; font-size: 13px; line-height: 1.4;
  padding: 11px 14px; border: 1px solid var(--border); border-radius: var(--r);
  background: var(--bg); color: var(--text); cursor: pointer;
  transition: border-color .12s, background .12s, transform .08s;
}
.example-chip:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.example-chip:active:not(:disabled) { transform: translateY(1px); }
.example-chip:disabled { opacity: .55; cursor: default; }

/* Asegura que los mensajes queden sobre el fondo */
.msgs { position: relative; z-index: 1; }
.chat-header { position: relative; z-index: 1; }
.chat-input  { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }

/* ── Adjuntos en el input ── */
.chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
.attach-btn {
  width: 38px; height: 38px; flex-shrink: 0; align-self: flex-end;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border); border-radius: var(--r);
  color: var(--text-muted); cursor: pointer; transition: background .12s, color .12s, border-color .12s;
}
.attach-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.attach-btn.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); border-color: var(--accent); }
.attach-btn:disabled { opacity: .5; cursor: default; }
.attach-url-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--r);
  background: var(--bg-surface);
}
.attach-url-input {
  flex: 1; border: none; background: transparent; outline: none;
  color: var(--text); font-size: 13px; font-family: inherit;
}
</style>
