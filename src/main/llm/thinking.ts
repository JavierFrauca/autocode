import type { AppConfig } from "@shared";

/**
 * Control del modo RAZONAMIENTO ("thinking") en modelos híbridos (DeepSeek V4 etc.).
 * `false` = sin pensar (rápido); `"high"`/`"max"` = pensar con esa profundidad; `undefined` = no mandar
 * nada (el modelo usa su valor por defecto). OJO: con thinking activo el modelo IGNORA temperature/top_p.
 */
export type ThinkingOption = boolean | "high" | "max";

/**
 * Parámetros de body para controlar el thinking, SOLO en proveedores DIRECTOS que sabemos mapear.
 * Para `local` (Ollama/LM Studio/**LiteLLM**) y proveedores aún sin mapear devuelve {} → no se manda nada:
 * LiteLLM gestiona sus propios parámetros y mandar el flag mal daría 400 (regla del usuario). Hoy mapeado:
 * DeepSeek (`thinking: {type}` + `reasoning_effort`). Añadir aquí otros (qwen `enable_thinking`, openai o-series…).
 */
export function thinkingParams(cfg: AppConfig, thinking: ThinkingOption | undefined): Record<string, unknown> {
  if (thinking === undefined) return {};
  switch (cfg.generation.provider) {
    case "deepseek":
      return thinking === false
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled" }, reasoning_effort: thinking === "max" ? "max" : "high" };
    default:
      return {}; // local (LiteLLM/Ollama) y resto de proveedores: no tocar
  }
}
