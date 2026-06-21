import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de llamada LLM propagado con AsyncLocalStorage. El runner envuelve la ejecución
 * de cada agente con su `signal` (de un AbortController) y su `agentRunId`; las funciones
 * `chat`/`chatStream`/`embed` lo leen de aquí — así se puede ABORTAR la petición HTTP a
 * LiteLLM de verdad (cortando el gasto de tokens) sin tener que pasar el signal por todas
 * las firmas de todos los agentes.
 */
export interface LlmCtx {
  signal?: AbortSignal;
  /** Si la llamada ocurre dentro de un agente, su run id (para no duplicarla en el visor). */
  agentRunId?: string | null;
}

export const llmContext = new AsyncLocalStorage<LlmCtx>();
