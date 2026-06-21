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
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    tier: "cloud",
    root: "https://api.openai.com",
    curatedModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    tier: "cloud",
    root: "https://api.deepseek.com",
    curatedModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  qwen: {
    id: "qwen",
    label: "Qwen",
    tier: "cloud",
    // Modo OpenAI-compatible de DashScope (internacional).
    root: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    curatedModels: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-coder-plus"],
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    tier: "cloud",
    root: "https://api.moonshot.ai",
    curatedModels: ["kimi-k2-0905-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
  },
  groq: {
    id: "groq",
    label: "Groq",
    tier: "cloud",
    root: "https://api.groq.com/openai",
    curatedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
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
