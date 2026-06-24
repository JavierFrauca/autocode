import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type AppConfig } from "@shared";
import { loadConfig, saveConfig } from "../config.js";
import { probeToolCalling } from "../llm/client.js";
import { PROVIDERS, PROVIDER_LIST, resolveBaseUrl } from "../llm/providers.js";

const Schema = z.object({
  generation: z.object({
    mode: z.enum(["cloud", "local"]),
    provider: z.enum([
      "anthropic", "openai", "deepseek", "qwen", "kimi", "groq", "openrouter", "local",
    ]),
    baseUrl: z.string().refine((s) => s === "" || /^https?:\/\//i.test(s), "URL inválida"),
    apiKey: z.string(),
    mainModel: z.string(),
    fastModel: z.string(),
  }),
  projectsRoot: z.string(),
  qdrantUrl: z.string(),
  advanced: z.object({
    promptEditor: z.boolean().default(false),
    docHistory: z.boolean().default(false),
  }).optional(),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s`)), ms),
    ),
  ]);
}

async function fetchModelIds(base: string, apiKey: string, timeoutMs = 8_000): Promise<string[]> {
  try {
    const r = await fetch(base.replace(/\/$/, "") + "/v1/models", {
      headers: { Authorization: `Bearer ${apiKey || "local"}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return [];
    const data = await r.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id).sort();
  } catch {
    return [];
  }
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config", async () => {
    const cfg = await loadConfig();
    return {
      ...cfg,
      // No devolvemos la API key; solo si hay una guardada (para que la UI muestre "•••").
      generation: { ...cfg.generation, apiKey: "", apiKeySet: !!cfg.generation.apiKey },
    };
  });

  app.put("/api/config", async (req, reply) => {
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const incoming = parsed.data;
    const existing = await loadConfig();

    // Si la apiKey llega vacía, mantenemos la existente (la UI no la reenvía a menos que se cambie).
    if (!incoming.generation.apiKey && existing.generation.apiKey) {
      incoming.generation.apiKey = existing.generation.apiKey;
    }

    await saveConfig(incoming as AppConfig);
    return { ok: true };
  });

  // Catálogo de proveedores para la UI: el flujo normal solo pinta el chip + usa los modelos
  // preseleccionados. `hasDefaults` indica si el proveedor trae modelos por defecto (los que no, como
  // OpenRouter, obligan a teclearlos en "Avanzado").
  app.get("/api/config/providers", async () => ({
    providers: PROVIDER_LIST.map((p) => ({
      id: p.id,
      label: p.label,
      tier: p.tier,
      defaultMain: p.defaultMain ?? "",
      defaultFast: p.defaultFast ?? "",
      hasDefaults: !!p.defaultMain && !!p.defaultFast,
    })),
  }));

  // Lista de modelos del proveedor en vivo (`/v1/models`). Si no responde, cae a la lista curada del
  // preset para que el desplegable no quede vacío. El usuario siempre puede teclear un modelo a mano.
  app.get("/api/config/models", async () => {
    const cfg = await loadConfig();
    const base = resolveBaseUrl(cfg);
    const preset = PROVIDERS[cfg.generation.provider];
    let models: string[] = [];
    if (base) models = await fetchModelIds(base, cfg.generation.apiKey);
    if (models.length === 0 && preset?.curatedModels) models = [...preset.curatedModels];
    return { models };
  });

  app.post("/api/config/verify", async () => {
    const cfg = await loadConfig();
    const base = resolveBaseUrl(cfg);

    // 1) Proveedor: /v1/models (ping + lista para validar que los modelos elegidos existen).
    const t0 = Date.now();
    let availableModels: string[] = [];
    let providerOk = false;
    if (base) {
      try {
        const r = await withTimeout(
          fetch(base.replace(/\/$/, "") + "/v1/models", {
            headers: { Authorization: `Bearer ${cfg.generation.apiKey || "local"}` },
          }),
          10_000,
        );
        providerOk = r.ok;
        if (r.ok) {
          const data = await r.json() as { data?: Array<{ id: string }> };
          availableModels = (data.data ?? []).map((m) => m.id);
        }
      } catch {}
    }
    const provider = { ok: providerOk, responseMs: Date.now() - t0, availableModels };

    // 2) Modelos principal/rápido: que existan en la lista (si la hay; algunos proveedores no listan).
    const checkModel = (model: string) => {
      if (!model) return { ok: false, model: "", error: "modelo no configurado", responseMs: 0 };
      if (!providerOk) return { ok: false, model, error: "el proveedor no responde", responseMs: 0 };
      const found = availableModels.length === 0 ? true : availableModels.includes(model);
      return {
        ok: found,
        model,
        responseMs: 0,
        error: found ? undefined : `"${model}" no está en /v1/models — disponibles: ${availableModels.slice(0, 8).join(", ")}`,
      };
    };

    // 3) Function-calling del modelo principal (lo exige el agente builder).
    const toolsProbe = async () => {
      if (!providerOk || !cfg.generation.mainModel) {
        return { ok: false, model: cfg.generation.mainModel, responseMs: 0 };
      }
      const start = Date.now();
      const ok = await probeToolCalling(cfg).catch(() => false);
      return {
        ok,
        model: cfg.generation.mainModel,
        responseMs: Date.now() - start,
        error: ok ? undefined : "el modelo principal no devolvió tool_calls (necesario para generar apps)",
      };
    };

    // Los embeddings ya no se verifican aquí: viven dentro de Nucleus (se cargan al primer indexado).
    const tools = await toolsProbe();

    return {
      provider,
      main: checkModel(cfg.generation.mainModel),
      fast: checkModel(cfg.generation.fastModel),
      tools,
    };
  });
}
