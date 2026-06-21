import { eq } from "drizzle-orm";
import type { AppConfig, GenerationConfig } from "@shared";
import { PROVIDERS } from "./llm/providers.js";
import { db, schema } from "./db/client.js";

const CONFIG_ROW_ID = "default";

export const DEFAULT_CONFIG: AppConfig = {
  generation: {
    mode: "cloud",
    provider: "anthropic",
    baseUrl: "",
    apiKey: "",
    mainModel: "",
    fastModel: "",
  },
  projectsRoot: "",
  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
};

/** Forma de config ANTERIOR (LiteLLM + 5 modelos por rol). Solo se usa para migrar al vuelo. */
interface LegacyConfig {
  litellm?: { baseUrl?: string; apiKey?: string };
  models?: {
    chat?: { model?: string };
    code?: { model?: string };
    cheap?: { model?: string };
    docs?: { model?: string };
    embeddings?: { model?: string; dim?: number };
  };
  embeddingsBaseUrl?: string;
}

export async function loadConfig(): Promise<AppConfig> {
  const rows = await db().select().from(schema.appConfig).where(eq(schema.appConfig.id, CONFIG_ROW_ID));
  const value = rows[0]?.value as Record<string, unknown> | undefined;
  return mergeWithDefaults(value ?? {});
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  // Trim para evitar desajustes silenciosos por espacios.
  cfg.generation.baseUrl    = (cfg.generation.baseUrl ?? "").trim();
  cfg.generation.mainModel  = (cfg.generation.mainModel ?? "").trim();
  cfg.generation.fastModel  = (cfg.generation.fastModel ?? "").trim();
  const merged = mergeWithDefaults(cfg as unknown as Record<string, unknown>);
  await db()
    .insert(schema.appConfig)
    .values({ id: CONFIG_ROW_ID, value: merged })
    .onConflictDoUpdate({ target: schema.appConfig.id, set: { value: merged, updatedAt: new Date().toISOString() } });
}

/**
 * Migra la config vieja (litellm + models) a la nueva (generation). El servidor LiteLLM del usuario
 * pasa a ser el preset "En tu equipo" → no pierde nada: sigue funcionando tras actualizar.
 */
function migrateLegacy(legacy: LegacyConfig): GenerationConfig {
  return {
    mode: "local",
    provider: "local",
    baseUrl: legacy.litellm?.baseUrl ?? "",
    apiKey: legacy.litellm?.apiKey ?? "",
    mainModel: legacy.models?.code?.model || legacy.models?.chat?.model || "",
    fastModel: legacy.models?.cheap?.model || "",
  };
}

export function mergeWithDefaults(partial: Record<string, unknown>): AppConfig {
  // ¿Config nueva (tiene `generation`) o vieja (tiene `litellm`)? Migramos solo si falta `generation`.
  const rawGen = partial.generation as Partial<GenerationConfig> | undefined;
  const generation: GenerationConfig = rawGen
    ? { ...DEFAULT_CONFIG.generation, ...rawGen }
    : "litellm" in partial
      ? migrateLegacy(partial as LegacyConfig)
      : { ...DEFAULT_CONFIG.generation };

  return {
    generation,
    projectsRoot: (partial.projectsRoot as string) ?? DEFAULT_CONFIG.projectsRoot,
    qdrantUrl: (partial.qdrantUrl as string) ?? DEFAULT_CONFIG.qdrantUrl,
    ...(partial.advanced ? { advanced: partial.advanced as AppConfig["advanced"] } : {}),
  };
}

/**
 * ¿Está la generación lista para usarse? Cloud necesita API key; local necesita URL. Ambos, modelos
 * principal y rápido. Los embeddings ya NO se gatean por el usuario (van locales siempre).
 */
export function isConfigured(cfg: AppConfig): boolean {
  const g = cfg.generation;
  const endpointReady = g.mode === "local"
    ? !!g.baseUrl
    : !!PROVIDERS[g.provider]?.root && !!g.apiKey;
  return endpointReady && !!g.mainModel && !!g.fastModel && !!cfg.projectsRoot;
}
