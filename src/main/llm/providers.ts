import type { AppConfig, ProviderId } from "@shared";

/**
 * Registro de proveedores de generación. Todos exponen un endpoint OpenAI-compatible: a `root` se le
 * añade `/v1` (igual que hacía `clientFor` con la URL de LiteLLM). El usuario elige proveedor + pega
 * su API key; AutoCode habla con el SDK de OpenAI como hasta ahora. `local` es el preset avanzado:
 * la URL la pone el usuario (Ollama/LM Studio/LiteLLM en su red).
 */
export interface ProviderPreset {
  id: ProviderId;
  label: string;
  tier: "cloud" | "local";
  /** Raíz del endpoint OpenAI-compatible, SIN `/v1`. Vacío para `local` (lo pone el usuario). */
  root: string;
  /**
   * Lista de respaldo si `/v1/models` no responde o es inútil (p.ej. Anthropic devuelve poco).
   * El usuario siempre puede teclear un modelo a mano; esto es solo para poblar el desplegable.
   */
  curatedModels?: string[];
  /**
   * Modelos PRESELECCIONADOS para este proveedor. El usuario normal NO elige modelo: pega su API key
   * y AutoCode usa estos. Si un ID se queda obsoleto, se cambia AQUÍ (único punto de mantenimiento) y
   * sale en la siguiente versión; mientras tanto, "Avanzado" permite sobreescribirlos a mano.
   * `defaultMain` debe soportar function-calling (lo exige el agente builder).
   */
  defaultMain?: string;
  defaultFast?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    tier: "cloud",
    root: "https://api.anthropic.com",
    curatedModels: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
    defaultMain: "claude-sonnet-4-6",
    defaultFast: "claude-haiku-4-5",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    tier: "cloud",
    root: "https://api.openai.com",
    // `gpt-5.5` sigue al último snapshot DENTRO de la familia 5.5 (no salta solo a la 6.x).
    curatedModels: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4-mini", "gpt-5.4-nano"],
    defaultMain: "gpt-5.5",
    defaultFast: "gpt-5.4-mini",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    tier: "cloud",
    root: "https://api.deepseek.com",
    // OJO: los alias `deepseek-chat`/`deepseek-reasoner` se APAGAN el 2026-07-24. Hay que usar V4.
    curatedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultMain: "deepseek-v4-pro",
    defaultFast: "deepseek-v4-flash",
  },
  qwen: {
    id: "qwen",
    label: "Qwen",
    tier: "cloud",
    // Modo OpenAI-compatible de DashScope (internacional).
    root: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    // `qwen-max`/`qwen-plus`/`qwen-flash` son alias "float": apuntan SIEMPRE al último de su gama
    // (mantenimiento casi cero). `qwen3.7-max` fija el flagship actual (agente/código) si se quiere pin.
    curatedModels: ["qwen-max", "qwen3.7-max", "qwen-plus", "qwen-flash", "qwen3-coder-plus"],
    defaultMain: "qwen-max",
    defaultFast: "qwen-flash",
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    tier: "cloud",
    root: "https://api.moonshot.ai",
    // La serie `kimi-k2-*-preview` se discontinuó el 2026-05-25 y `kimi-latest` ya no se mantiene.
    curatedModels: ["kimi-k2.7-code", "kimi-k2.6", "moonshot-v1-128k"],
    defaultMain: "kimi-k2.7-code",
    defaultFast: "kimi-k2.6",
  },
  groq: {
    id: "groq",
    label: "Groq",
    tier: "cloud",
    root: "https://api.groq.com/openai",
    // Groq anunció la deprecación de los Llama 3.x (jun-2026); recomienda los GPT-OSS (con tool use).
    curatedModels: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"],
    defaultMain: "openai/gpt-oss-120b",
    defaultFast: "openai/gpt-oss-20b",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    tier: "cloud",
    root: "https://openrouter.ai/api",
  },
  local: {
    id: "local",
    label: "En tu equipo (Ollama · LM Studio · LiteLLM)",
    tier: "local",
    root: "",
  },
};

/** Lista para la UI (orden estable: cloud primero, local al final). */
export const PROVIDER_LIST: ProviderPreset[] = [
  PROVIDERS.anthropic,
  PROVIDERS.openai,
  PROVIDERS.deepseek,
  PROVIDERS.qwen,
  PROVIDERS.kimi,
  PROVIDERS.groq,
  PROVIDERS.openrouter,
  PROVIDERS.local,
];

/**
 * Raíz del endpoint a usar para la generación. Cloud → la del preset (la URL guardada se ignora,
 * la manda el proveedor). Local → la que escribió el usuario. Sin `/v1` (lo añade `clientFor`).
 */
export function resolveBaseUrl(cfg: AppConfig): string {
  const g = cfg.generation;
  if (g.mode === "local") return (g.baseUrl ?? "").trim();
  const preset = PROVIDERS[g.provider];
  return preset?.root ?? "";
}
