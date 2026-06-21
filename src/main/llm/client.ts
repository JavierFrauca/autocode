import OpenAI from "openai";
import type { AppConfig, ModelRole } from "@shared";
import { EMBEDDINGS_MODEL } from "@shared";
import { resolveBaseUrl } from "./providers.js";
import { embedTexts } from "./local-embeddings.js";
import { startCall } from "./activity.js";
import { llmContext } from "./context.js";
import { EmbedBusyError, Mutex } from "./queue.js";
import { thinkingParams, type ThinkingOption } from "./thinking.js";
import { log } from "../log.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Control del modo razonamiento ("thinking"); solo se manda a proveedores directos. Ver `thinking.ts`. */
  thinking?: ThinkingOption;
}

export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

function clientFor(cfg: AppConfig): OpenAI {
  const base = resolveBaseUrl(cfg).replace(/\/$/, "");
  return new OpenAI({
    baseURL: base + "/v1",
    // El SDK exige apiKey no vacía; en local (Ollama/LM Studio) su valor suele dar igual.
    apiKey: cfg.generation.apiKey || "local",
  });
}

function modelFor(cfg: AppConfig, role: Exclude<ModelRole, "embeddings">): string {
  // Los 5 roles se sirven con 2 modelos: `cheap` con el rápido; chat/code/docs con el principal.
  const m = role === "cheap" ? cfg.generation.fastModel : cfg.generation.mainModel;
  if (!m) throw new Error(`Model not configured for role "${role}"`);
  return m;
}

export async function chat(
  cfg: AppConfig,
  role: Exclude<ModelRole, "embeddings">,
  messages: ChatMessage[],
  opts: ChatOptions = {},
  source: string = role,
): Promise<ChatResult> {
  const client = clientFor(cfg);
  const model = modelFor(cfg, role);
  const ctx = llmContext.getStore();
  const tracker = startCall({ model, role, source, agentRunId: ctx?.agentRunId ?? null, messages });
  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: messages as any,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens,
        response_format: opts.jsonMode ? { type: "json_object" } : undefined,
        ...thinkingParams(cfg, opts.thinking),
      } as any,
      { signal: ctx?.signal },
    );
    const choice = res.choices[0];
    const tokensIn = res.usage?.prompt_tokens ?? 0;
    const tokensOut = res.usage?.completion_tokens ?? 0;
    tracker.done({ tokensIn, tokensOut });
    return { content: choice?.message?.content ?? "", tokensIn, tokensOut, model };
  } catch (e: any) {
    tracker.fail(String(e?.message ?? e));
    throw e;
  }
}

export async function* chatStream(
  cfg: AppConfig,
  role: Exclude<ModelRole, "embeddings">,
  messages: ChatMessage[],
  opts: ChatOptions = {},
  source: string = role,
): AsyncGenerator<{ delta: string } | { done: ChatResult }> {
  const client = clientFor(cfg);
  const model = modelFor(cfg, role);
  const ctx = llmContext.getStore();
  const tracker = startCall({ model, role, source, agentRunId: ctx?.agentRunId ?? null, messages });
  let content = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: messages as any,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: ctx?.signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        content += delta;
        yield { delta };
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens;
        tokensOut = chunk.usage.completion_tokens;
      }
    }
    tracker.done({ tokensIn, tokensOut });
    yield { done: { content, tokensIn, tokensOut, model } };
  } catch (e: any) {
    tracker.fail(String(e?.message ?? e));
    throw e;
  }
}

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema de los parámetros (objeto). */
  parameters: Record<string, unknown>;
  run: (args: any) => Promise<string>;
}

export interface ToolLoopResult {
  /** Mensajes aumentados (incluye tool_calls del asistente y resultados de tools). */
  messages: any[];
  toolsUsed: string[];
  /** false si el modelo/endpoint no soporta function-calling (se debe continuar sin tools). */
  supported: boolean;
}

/**
 * Bucle agéntico acotado: ofrece `tools` al modelo y ejecuta las que pida, realimentando
 * los resultados, hasta que deje de pedir tools o se agoten las rondas. NO produce la
 * respuesta final al usuario; solo deja los mensajes listos (con el contexto recabado)
 * para una pasada de streaming posterior. Degrada con gracia si el modelo no soporta tools.
 */
export async function runToolLoop(
  cfg: AppConfig,
  role: Exclude<ModelRole, "embeddings">,
  baseMessages: ChatMessage[],
  tools: ChatTool[],
  source: string = "chat-tools",
  maxRounds = 4,
  thinking?: ChatOptions["thinking"],
): Promise<ToolLoopResult> {
  const client = clientFor(cfg);
  const model = modelFor(cfg, role);
  const toolSpecs = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const byName = new Map(tools.map((t) => [t.name, t]));

  const messages: any[] = [...baseMessages];
  const toolsUsed: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const ctx = llmContext.getStore();
    const tracker = startCall({ model, role, source, agentRunId: ctx?.agentRunId ?? null, messages });
    let res;
    try {
      res = await client.chat.completions.create(
        { model, messages, tools: toolSpecs, tool_choice: "auto", temperature: 0, ...thinkingParams(cfg, thinking) } as any,
        { signal: ctx?.signal },
      );
      tracker.done({
        tokensIn: res.usage?.prompt_tokens ?? 0,
        tokensOut: res.usage?.completion_tokens ?? 0,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      tracker.fail(msg);
      // Antes esto SIEMPRE concluía "el modelo no soporta tools", OCULTANDO el error real (un 400 por el
      // esquema de una tool, contexto excedido, otro parámetro, un corte de red…). Ahora: (1) lo
      // REGISTRAMOS en el log con detalle, y (2) solo lo tratamos como "sin function-calling" si el error
      // lo dice DE VERDAD; cualquier otro error se PROPAGA para que el caller muestre el motivo real.
      const status = e?.status ?? e?.response?.status;
      log.warn("toolLoop", "la llamada con tools falló", { source, model, status, error: msg.slice(0, 800) });
      const noFunctionCalling =
        /tool|function[_ ]?call/i.test(msg) &&
        /not support|unsupported|no .{0,20}support|does ?n'?t support|not available|no implement|sin soporte/i.test(msg);
      if (noFunctionCalling) return { messages: baseMessages, toolsUsed, supported: false };
      throw e;
    }

    const choice = res.choices[0]?.message;
    const calls = choice?.tool_calls ?? [];
    if (!choice || calls.length === 0) {
      // El modelo no quiere (más) tools; devolvemos el contexto recabado.
      return { messages, toolsUsed, supported: true };
    }

    // Registrar la intención del asistente y ejecutar cada tool.
    messages.push({ role: "assistant", content: choice.content ?? "", tool_calls: calls });
    for (const call of calls) {
      const tool = byName.get(call.function?.name ?? "");
      let result: string;
      if (!tool) {
        result = `Error: tool desconocida "${call.function?.name}"`;
      } else {
        try {
          const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
          result = await tool.run(args);
        } catch (e: any) {
          result = `Error ejecutando la tool: ${e?.message ?? e}`;
        }
        toolsUsed.push(tool.name);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  return { messages, toolsUsed, supported: true };
}

// ── Cola de embeddings ────────────────────────────────────────────────────────────────────
// Los embeddings corren AHORA en proceso (bge-m3 vía ONNX, ./local-embeddings.ts): sin red, sin
// proveedor. La inferencia en CPU conviene serializarla (varias a la vez solo compiten por la CPU),
// así que mantenemos el mutex: un embedding cada vez. Las llamadas INTERACTIVAS (búsqueda del chat)
// ceden el turno si la cola está ocupada, para no bloquear la conversación tras un `ingest` largo;
// el resto (ingest, índices) esperan. El Mutex vive en ./queue.js (con sus tests).
const embedMutex = new Mutex();
const EMBED_QUEUE_WAIT_MS = Number(process.env.AUTOCODE_EMBED_QUEUE_WAIT_MS) || 10_000;
// Cuántos embeddings PESADOS (ingest, índices, reindex) hay en marcha. Si hay alguno, el auto-RAG
// del chat (interactivo) se salta directamente: la CPU está ocupada, mejor responder sin contexto
// que competir y enlentecerlo todo.
let backgroundEmbedsInFlight = 0;

export async function embed(
  cfg: AppConfig,
  texts: string[],
  source: string = "embeddings",
  opts: { interactive?: boolean } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const interactive = !!opts.interactive;

  // Pausa del auto-RAG: si hay un ingest/indexado pesado en curso, la búsqueda del chat se salta
  // (EmbedBusyError → el llamante responde sin contexto) en vez de meterse en la cola.
  if (interactive && backgroundEmbedsInFlight > 0) throw new EmbedBusyError();

  void cfg; // la config ya no elige proveedor de embeddings: van siempre locales.
  const model = `${EMBEDDINGS_MODEL} (local)`;
  const ctx = llmContext.getStore();

  if (!interactive) backgroundEmbedsInFlight++;
  try {
    // Esperar turno ANTES de marcar "running" → el panel muestra como mucho 1 embedding en proceso.
    const release = await embedMutex.acquire(interactive ? EMBED_QUEUE_WAIT_MS : undefined);
    const tracker = startCall({ model, role: "embeddings", source, agentRunId: ctx?.agentRunId ?? null });
    try {
      const vectors = await embedTexts(texts);
      tracker.done({ tokensIn: 0 });
      return vectors;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      tracker.fail(msg);
      throw new Error(msg);
    } finally {
      release();
    }
  } finally {
    if (!interactive) backgroundEmbedsInFlight--;
  }
}

export async function pingProvider(cfg: AppConfig): Promise<boolean> {
  const base = resolveBaseUrl(cfg).replace(/\/$/, "");
  if (!base) return false;
  try {
    const r = await fetch(base + "/v1/models", {
      headers: { Authorization: `Bearer ${cfg.generation.apiKey || "local"}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * ¿El modelo principal soporta function-calling? El agente builder lo EXIGE. Una llamada con una tool
 * trivial: si el modelo devuelve `tool_calls`, vale. (Portado de scripts/fc-probe.cjs.)
 */
export async function probeToolCalling(cfg: AppConfig): Promise<boolean> {
  const model = cfg.generation.mainModel;
  if (!model) return false;
  try {
    const res = await clientFor(cfg).chat.completions.create({
      model,
      messages: [{ role: "user", content: "Llama a la tool `ping` con x=1." }],
      tools: [{
        type: "function",
        function: {
          name: "ping",
          description: "Responde pong",
          parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        },
      }],
      tool_choice: "auto",
      temperature: 0,
      max_tokens: 64,
    });
    return (res.choices[0]?.message?.tool_calls?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
