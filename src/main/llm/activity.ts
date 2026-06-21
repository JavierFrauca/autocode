import { ulid } from "ulid";

export type LlmStatus = "running" | "done" | "failed";

export interface LlmCall {
  id: string;
  model: string;
  role: string;
  source: string;
  status: LlmStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  /** run id del agente si la llamada ocurre dentro de uno (null = chat/embeddings/standalone). */
  agentRunId?: string | null;
  /** true si la llamada registró un cancelador y se puede abortar desde el panel. */
  cancellable?: boolean;
  /** Resumen (capado) de lo que ENTRA al modelo: mensajes role+content. Para inspección en vivo en el panel. */
  input?: { role: string; content: string }[];
}

// Capado del input para el visor: ni reventar memoria (anillo de 60) ni la red (solo se manda el de la
// llamada en curso). Suficiente para confirmar "qué está entrando", no para auditar el prompt entero.
const INPUT_MSG_CAP = 8000;    // chars por mensaje
const INPUT_TOTAL_CAP = 60000; // chars en total

function summarizeInput(messages: { role: string; content: unknown; tool_calls?: unknown }[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  let total = 0;
  for (const m of messages) {
    let c = typeof m.content === "string" ? m.content : m.content == null ? "" : JSON.stringify(m.content);
    if (m.tool_calls) {
      const prefix = c ? `${c}\n` : "";
      c = `${prefix}tool_calls: ${JSON.stringify(m.tool_calls)}`;
    }
    if (c.length > INPUT_MSG_CAP) c = `${c.slice(0, INPUT_MSG_CAP)}\n…[+${c.length - INPUT_MSG_CAP} caracteres]`;
    out.push({ role: m.role, content: c });
    total += c.length;
    if (total > INPUT_TOTAL_CAP) { out.push({ role: "system", content: "…[resto recortado]" }); break; }
  }
  return out;
}

export interface CallTracker {
  done(info?: { tokensIn?: number; tokensOut?: number }): void;
  fail(error: string): void;
  /** Registra cómo abortar esta llamada (p. ej. controller.abort) para cancelarla desde el panel. */
  attachCancel(abort: () => void): void;
}

const RING_MAX = 60;
const calls: LlmCall[] = []; // más antiguas primero
const cancellers = new Map<string, () => void>(); // id de llamada → cómo abortarla

export function startCall(info: {
  model: string;
  role: string;
  source: string;
  agentRunId?: string | null;
  /** Mensajes que entran al modelo (se guardan capados para el visor). Embeddings no traen. */
  messages?: { role: string; content: unknown; tool_calls?: unknown }[];
}): CallTracker {
  const t0 = Date.now();
  const entry: LlmCall = {
    id: `call_${ulid().toLowerCase()}`,
    model: info.model,
    role: info.role,
    source: info.source,
    agentRunId: info.agentRunId ?? null,
    status: "running",
    startedAt: new Date(t0).toISOString(),
    input: info.messages ? summarizeInput(info.messages) : undefined,
  };
  calls.push(entry);
  while (calls.length > RING_MAX) calls.shift();

  const finish = () => {
    cancellers.delete(entry.id);
    entry.cancellable = false;
    entry.finishedAt = new Date().toISOString();
    entry.durationMs = Date.now() - t0;
  };

  return {
    done(extra) {
      finish();
      entry.status = "done";
      if (extra?.tokensIn != null) entry.tokensIn = extra.tokensIn;
      if (extra?.tokensOut != null) entry.tokensOut = extra.tokensOut;
    },
    fail(error) {
      finish();
      entry.status = "failed";
      entry.error = error;
    },
    attachCancel(abort) {
      cancellers.set(entry.id, abort);
      entry.cancellable = true;
    },
  };
}

/** Cancela una llamada concreta por id (chat/embeddings/búsqueda). true si había algo que abortar. */
export function cancelCall(id: string): boolean {
  const abort = cancellers.get(id);
  if (!abort) return false;
  cancellers.delete(id);
  try { abort(); } catch { /* el aborto nunca debe tumbar nada */ }
  return true;
}

/** Cancela todas las llamadas en curso que sean cancelables. Devuelve cuántas. */
export function cancelAllCalls(): number {
  let n = 0;
  for (const [, abort] of cancellers) {
    try { abort(); n++; } catch { /* ignore */ }
  }
  cancellers.clear();
  return n;
}

/** Todas las llamadas recientes (anillo), más nuevas primero. */
export function getCalls(): LlmCall[] {
  return [...calls].reverse();
}

/** Compat: una llamada "actual" (la primera en curso) + la última terminada. */
export function getActivity(): { current: LlmCall | null; last: LlmCall | null } {
  const current = calls.find((c) => c.status === "running") ?? null;
  const last = [...calls].reverse().find((c) => c.status !== "running") ?? null;
  return { current, last };
}
