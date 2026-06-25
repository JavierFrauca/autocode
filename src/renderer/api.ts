function base(): string {
  return (globalThis as any).__AUTOCODE_API_BASE__ ?? "http://127.0.0.1:4317";
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body != null;
  const r = await fetch(base() + path, {
    credentials: "include",
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    ...init,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${r.statusText} — ${text}`);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export interface ScreenMapNode {
  slug: string;
  name: string;
  kind: "pagina" | "modal";
  children: ScreenMapNode[];
}

export const api = {
  health: () => req<any>("/api/health"),
  llmActivity: () => req<any>("/api/llm-activity"),
  getConfig: () => req<any>("/api/config"),
  saveConfig: (cfg: any) => req<any>("/api/config", { method: "PUT", body: JSON.stringify(cfg) }),
  verifyConfig: () => req<any>("/api/config/verify", { method: "POST", body: JSON.stringify({}) }),
  availableModels: () => req<{ models: string[] }>("/api/config/models"),
  // Catálogo de proveedores con sus modelos preseleccionados (config curada).
  providers: () => req<{ providers: { id: string; label: string; tier: "cloud" | "local"; defaultMain: string; defaultFast: string; hasDefaults: boolean }[] }>("/api/config/providers"),
  projects: () => req<any[]>("/api/projects"),
  createProject: (name: string, description?: string) =>
    req<any>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  getProject: (id: string) => req<any>(`/api/projects/${id}`),
  deleteProject: (id: string) => req<any>(`/api/projects/${id}`, { method: "DELETE" }),

  sessions: (projectId: string) => req<any[]>(`/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, title?: string) =>
    req<any>(`/api/projects/${projectId}/sessions`, { method: "POST", body: JSON.stringify({ title }) }),
  renameSession: (sessionId: string, title: string | null) =>
    req<any>(`/api/sessions/${sessionId}`, { method: "PUT", body: JSON.stringify({ title }) }),
  suggestSessionTitle: (sessionId: string, force = false) =>
    req<{ title: string | null; kept?: boolean }>(`/api/sessions/${sessionId}/suggest-title`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  messages: (sessionId: string) => req<any[]>(`/api/sessions/${sessionId}/messages`),

  documents: (projectId: string) => req<any[]>(`/api/projects/${projectId}/documents`),
  document: (id: string) => req<any>(`/api/documents/${id}`),
  revision: (id: string) => req<any>(`/api/revisions/${id}`),

  agentRuns: (projectId: string) => req<any[]>(`/api/projects/${projectId}/agent-runs`),
  agentRun: (id: string) => req<any>(`/api/agent-runs/${id}`),
  applyRun: (id: string, apply: boolean) =>
    req<any>(`/api/agent-runs/${id}/apply`, { method: "POST", body: JSON.stringify({ apply }) }),
  cancelRun: (id: string) => req<any>(`/api/agent-runs/${id}/cancel`, { method: "POST" }),
  deleteRun: (id: string) => req<any>(`/api/agent-runs/${id}`, { method: "DELETE" }),
  enqueueAgent: (projectId: string, type: string, input: any) =>
    req<any>(`/api/projects/${projectId}/agents/${type}`, { method: "POST", body: JSON.stringify(input) }),

  search: (question: string, projectIds: string[], topK?: number) =>
    req<any>("/api/search", { method: "POST", body: JSON.stringify({ question, projectIds, topK }) }),
  searchRun: (runId: string) => req<any>(`/api/search/${runId}`),

  // Files API
  projectFiles: (projectId: string) => req<any>(`/api/projects/${projectId}/files`),
  getFileContent: (projectId: string, path: string) =>
    req<any>(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  putFile: (projectId: string, path: string, content: string) =>
    req<any>(`/api/projects/${projectId}/files`, { method: "PUT", body: JSON.stringify({ path, content }) }),
  deleteFile: (projectId: string, path: string) =>
    req<any>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  searchDocs: (projectId: string, query: string) =>
    req<any>(`/api/projects/${projectId}/files/search`, { method: "POST", body: JSON.stringify({ query }) }),
  getDocRevisions: (projectId: string, path: string) =>
    req<any>(`/api/projects/${projectId}/files/revisions?path=${encodeURIComponent(path)}`),
  restoreDocRevision: (projectId: string, path: string, revisionId: string) =>
    req<any>(`/api/projects/${projectId}/files/restore`, { method: "POST", body: JSON.stringify({ path, revisionId }) }),

  // Maqueta (boceto HTML) de una pantalla — artefacto adjunto al spec, no indexado
  getScreenMockup: (projectId: string, path: string) =>
    req<{ exists: boolean; html: string | null; stale: boolean; generatedAt: string | null }>(
      `/api/projects/${projectId}/screens/mockup?path=${encodeURIComponent(path)}`),
  // Con `instruction` ("modificar con IA") el boceto actual se modifica según lo que pida el usuario.
  generateScreenMockup: (projectId: string, path: string, instruction?: string) =>
    req<{ ok: boolean; html: string | null }>(
      `/api/projects/${projectId}/screens/mockup`, { method: "POST", body: JSON.stringify({ path, instruction }) }),
  // "Modificar con IA" coherente: aplica el cambio al spec (.md) y regenera la maqueta. Devuelve ambos.
  modifyScreen: (projectId: string, path: string, instruction: string) =>
    req<{ ok: boolean; spec: string | null; html: string | null }>(
      `/api/projects/${projectId}/screens/modify`, { method: "POST", body: JSON.stringify({ path, instruction }) }),
  // Todas las pantallas con su maqueta y su jerarquía (página/modal, padre, orden).
  listScreens: (projectId: string) =>
    req<{ screens: { path: string; slug: string; name: string; kind: "pagina" | "modal"; parent: string | null; order: number; mockupExists: boolean; stale: boolean; html: string | null }[] }>(
      `/api/projects/${projectId}/screens`),
  // Crea una pantalla (página o modal de otra).
  createScreen: (projectId: string, name: string, kind: "pagina" | "modal" = "pagina", parent: string | null = null) =>
    req<{ ok: boolean; path: string; slug: string; name: string; kind: string; parent: string | null }>(
      `/api/projects/${projectId}/screens`, { method: "POST", body: JSON.stringify({ name, kind, parent }) }),
  // Mueve/reordena/convierte en modal (frontmatter).
  setScreenMeta: (projectId: string, path: string, meta: { kind?: "pagina" | "modal"; parent?: string | null; order?: number }) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/screens/meta`, { method: "POST", body: JSON.stringify({ path, ...meta }) }),
  // Define TODAS las pantallas con IA (agente screen-planner).
  defineScreens: (projectId: string) =>
    req<{ ok: boolean; created: number; skipped: number; total: number }>(
      `/api/projects/${projectId}/screens/define`, { method: "POST", body: JSON.stringify({}) }),
  // Borra una pantalla (spec + maqueta) por el servicio único.
  deleteScreen: (projectId: string, path: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/screens?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  // ── Mapa de pantallas (fuente única de la estructura) ──
  getScreenMap: (projectId: string) =>
    req<{ tree: ScreenMapNode[]; status: Record<string, { hasScreen: boolean; mockupExists: boolean; stale: boolean; path: string }> }>(
      `/api/projects/${projectId}/screens/map`),
  saveScreenMap: (projectId: string, tree: ScreenMapNode[]) =>
    req<{ ok: boolean; created: number; updated: number; orphans: string[] }>(
      `/api/projects/${projectId}/screens/map`, { method: "POST", body: JSON.stringify({ tree }) }),
  materializeScreens: (projectId: string) =>
    req<{ ok: boolean; created: number; updated: number; orphans: string[] }>(
      `/api/projects/${projectId}/screens/materialize`, { method: "POST", body: JSON.stringify({}) }),

  // Prompts API
  listPrompts: () => req<{ prompts: { name: string; isCustom: boolean }[] }>("/api/prompts"),
  getPrompt: (name: string) => req<{ content: string; isCustom: boolean; defaultContent: string }>(`/api/prompts/${name}`),
  savePrompt: (name: string, content: string) => req<any>(`/api/prompts/${name}`, { method: "PUT", body: JSON.stringify({ content }) }),
  resetPrompt: (name: string) => req<{ ok: boolean; content: string; isCustom: boolean }>(`/api/prompts/${name}/reset`, { method: "POST", body: JSON.stringify({}) }),

  // Media API
  listMedia: (projectId: string) =>
    req<{ files: { name: string; size: number; url: string; projectPath: string }[] }>(`/api/projects/${projectId}/media`),
  uploadMedia: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const base = (globalThis as any).__AUTOCODE_API_BASE__ ?? "http://127.0.0.1:4317";
    return fetch(`${base}/api/projects/${projectId}/media`, {
      method: "POST", credentials: "include", body: form,
    }).then((r) => r.json());
  },
  deleteMedia: (projectId: string, filename: string) =>
    req<any>(`/api/projects/${projectId}/media/${encodeURIComponent(filename)}`, { method: "DELETE" }),
  mediaUrl: (projectId: string, filename: string) => {
    const base = (globalThis as any).__AUTOCODE_API_BASE__ ?? "http://127.0.0.1:4317";
    return `${base}/api/projects/${projectId}/media/${encodeURIComponent(filename)}`;
  },

  // Adjuntos del chat: clasifica imagen→Recursos, texto/PDF/docx→Documentos (DOC-). Con `tecnico`,
  // el documento se registra como DOCUMENTO TÉCNICO (fuente canónica destilada a paper DT-NNN).
  attachFile: (projectId: string, file: File, opts?: { tecnico?: boolean; tema?: string }) => {
    const form = new FormData();
    form.append("file", file);
    const base = (globalThis as any).__AUTOCODE_API_BASE__ ?? "http://127.0.0.1:4317";
    const qs = opts?.tecnico ? `?tecnico=1${opts.tema ? `&tema=${encodeURIComponent(opts.tema)}` : ""}` : "";
    return fetch(`${base}/api/projects/${projectId}/attach${qs}`, { method: "POST", credentials: "include", body: form })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.text().catch(() => "")) || `error ${r.status}`);
        return r.json() as Promise<{ kind: "resource" | "document" | "technical"; name: string; projectPath: string }>;
      });
  },
  attachUrl: (projectId: string, url: string, opts?: { tecnico?: boolean; tema?: string }) =>
    req<{ kind: string; name: string; projectPath: string; source?: string }>(
      `/api/projects/${projectId}/attach-url`,
      { method: "POST", body: JSON.stringify({ url, tecnico: opts?.tecnico, tema: opts?.tema }) },
    ),

  // Plan API
  getPlan: (projectId: string) => req<any>(`/api/projects/${projectId}/plan`),
  generatePlan: (projectId: string, appType: string) =>
    req<any>(`/api/projects/${projectId}/plan/generate`, { method: "POST", body: JSON.stringify({ appType }) }),

  // Ejecución del plan (construir la app)
  execute: (projectId: string, feedback?: string, fromScratch?: boolean) =>
    req<{ runId: string }>(`/api/projects/${projectId}/execute`, { method: "POST", body: JSON.stringify({ feedback, fromScratch }) }),
  validateVersion: (projectId: string, feedback?: string) =>
    req<{ runId: string }>(`/api/projects/${projectId}/validate-version`, { method: "POST", body: JSON.stringify({ feedback }) }),
  // "Crear las pruebas ahora" (voluntario, antes de validar): escribe las pruebas de aceptación.
  writeTests: (projectId: string) =>
    req<{ runId: string }>(`/api/projects/${projectId}/write-tests`, { method: "POST", body: JSON.stringify({}) }),
  // Previsualización web: AutoCode arranca la app (SQLite, sin Docker) y abre el navegador.
  previewStart: (projectId: string) =>
    req<{ ok: boolean; url: string | null; kind: "web" | "desktop"; credenciales?: { email: string; password: string } | null; apiKey?: string | null }>(`/api/projects/${projectId}/preview/start`, { method: "POST", body: JSON.stringify({}) }),
  previewStop: (projectId: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/preview/stop`, { method: "POST", body: JSON.stringify({}) }),
  previewStatus: (projectId: string) =>
    req<{ running: boolean; url: string | null; kind: "web" | "desktop" | null; credenciales?: { email: string; password: string } | null; apiKey?: string | null }>(`/api/projects/${projectId}/preview/status`),
  cancelExecution: (projectId: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/execute/cancel`, { method: "POST", body: JSON.stringify({}) }),
  openAppFolder: (projectId: string) =>
    req<{ ok: boolean; path: string }>(`/api/projects/${projectId}/open-folder`, { method: "POST", body: JSON.stringify({}) }),
  // Distribución: preparar un instalador (.exe) de la app de escritorio para repartirla.
  packageApp: (projectId: string) =>
    req<{ runId: string; alreadyRunning?: boolean }>(`/api/projects/${projectId}/package`, { method: "POST", body: JSON.stringify({}) }),
  packageStatus: (projectId: string) =>
    req<{ state: "none" | "running" | "done" | "failed"; kind?: "installer" | "bundle"; installerPath?: string; bundlePath?: string; error?: string }>(`/api/projects/${projectId}/package`),
  cancelPackage: (projectId: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/package/cancel`, { method: "POST", body: JSON.stringify({}) }),
  revealInstaller: (projectId: string) =>
    req<{ ok: boolean; path: string }>(`/api/projects/${projectId}/reveal-installer`, { method: "POST", body: JSON.stringify({}) }),
  getExecution: (projectId: string) => req<any>(`/api/projects/${projectId}/execution`),

  // Arquitectura (ADR-0): fuente de verdad del tipo/stack. Se ve/edita en Documentos.
  // ensure crea el ADR por defecto si aún no existe (idempotente).
  ensureArchitecture: (projectId: string) =>
    req<{ exists: boolean; body: string; appType: "server" | "electron"; isDefault: boolean }>(
      `/api/projects/${projectId}/architecture/ensure`, { method: "POST", body: JSON.stringify({}) },
    ),

  // Actividad LiteLLM (visor global de la cola)
  llmQueue: () => req<{ runs: any[]; activeCount: number; current: any }>("/api/llm/queue"),
  cancelLlm: (id: string) => req<{ ok: boolean }>(`/api/llm/cancel/${id}`, { method: "POST", body: JSON.stringify({}) }),
  cancelAllLlm: () => req<{ cancelled: number }>("/api/llm/cancel-all", { method: "POST", body: JSON.stringify({}) }),
  clearLlmHistory: () => req<{ ok: boolean }>("/api/llm/history", { method: "DELETE" }),

  // Librería y templates (galería de patrones/componentes)
  libraryTree: (source: "library" | "templates") =>
    req<{ source: string; tree: any[] }>(`/api/library/tree?source=${source}`),
  libraryContent: (source: "library" | "templates", filePath: string) =>
    req<{ content: string }>(`/api/library/content?source=${source}&path=${encodeURIComponent(filePath)}`),
  saveLibraryContent: (source: "library" | "templates", filePath: string, content: string) =>
    req<{ ok: boolean }>("/api/library/content", { method: "PUT", body: JSON.stringify({ source, path: filePath, content }) }),

  // Versiones que funcionan (máquina del tiempo)
  versions: (projectId: string) =>
    req<{ id: string; date: string; label: string }[]>(`/api/projects/${projectId}/versions`),
  revertVersion: (projectId: string, versionId: string) =>
    req<{ ok: boolean }>(`/api/projects/${projectId}/revert`, {
      method: "POST",
      body: JSON.stringify({ versionId }),
    }),
};

export async function* chatStream(
  projectId: string,
  sessionId: string,
  content: string,
): AsyncGenerator<{ event: string; data: any }> {
  // UNA sola petición, SIN reintentos automáticos. El re-POST a /api/chat duplicaba el
  // mensaje del usuario y disparaba 2-3 llamadas al modelo por cada envío. El servidor abre
  // el stream y fuerza cabeceras al instante (flushHeaders), así que este fetch se resuelve
  // enseguida; si falla aquí es un fallo real de conexión y lo decimos claro (la vista ofrece
  // reintentar a mano, sin duplicar nada).
  // Clave de idempotencia: un id estable por envío. Si la petición se reintenta a nivel de red
  // (mismo body), el servidor lo detecta y NO inserta el mensaje ni vuelve a llamar al modelo.
  const clientMsgId = `msg_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`)}`;
  let r: Response;
  try {
    r = await fetch(base() + "/api/chat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, sessionId, content, clientMsgId }),
    });
  } catch (e: any) {
    yield {
      event: "error",
      data: {
        code: "no_connection",
        message:
          "No pude contactar con el servidor interno de AutoCode. " +
          "Si acabas de abrir la app, espera unos segundos y reintenta; si sigue, reinicia AutoCode.",
      },
    };
    return;
  }
  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    yield {
      event: "error",
      data: {
        code: `http_${r.status}`,
        message: `El servidor respondió con un error ${r.status}.${detail ? " " + detail.slice(0, 300) : ""}`,
      },
    };
    return;
  }
  if (!r.body) {
    yield { event: "error", data: { code: "no_body", message: "El servidor no devolvió contenido." } };
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const block of parts) {
        if (!block.trim() || block.trimStart().startsWith(":")) continue; // skip comments/keepalive
        const lines = block.split("\n");
        let event = "message";
        let data = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        try {
          yield { event, data: JSON.parse(data) };
        } catch {
          yield { event, data };
        }
      }
    }
  } catch (e: any) {
    yield {
      event: "error",
      data: {
        code: "stream_interrupted",
        message:
          "Se cortó la conexión mientras la IA respondía. La respuesta puede haberse guardado igualmente; " +
          "recarga la conversación para verla.",
      },
    };
  }
}

/** SQLite `datetime('now')` devuelve "YYYY-MM-DD HH:MM:SS" en UTC, que algunos motores
 *  parsean como Invalid Date. Normalizamos a ISO antes de pasarlo a `new Date()`. */
export function parseDbDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (s.includes("T")) return new Date(s);
  // "2026-06-13 09:33:44" -> "2026-06-13T09:33:44Z"
  const iso = s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDbDate(s: string | null | undefined, fallback = "—"): string {
  const d = parseDbDate(s);
  return d ? d.toLocaleString() : fallback;
}

export function timeAgo(s: string | null | undefined): string {
  const d = parseDbDate(s);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const s_ = Math.floor(diff / 1000);
  if (s_ < 60) return `hace ${s_}s`;
  const m = Math.floor(s_ / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)}sem`;
  if (days < 365) return `hace ${Math.floor(days / 30)}mes`;
  return `hace ${Math.floor(days / 365)}año`;
}
