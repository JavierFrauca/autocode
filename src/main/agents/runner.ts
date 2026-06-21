import { and, asc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { AgentType, AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { runDocumenter } from "./documenter.js";
import { runPlanner } from "./planner.js";
import { runReindexer } from "./reindexer.js";
import { runExecutor } from "./executor.js";
import { runReconciler } from "./reconciler.js";
import { runPackager } from "./packager.js";
import { llmContext } from "../llm/context.js";

/** AbortController por run en vuelo, para abortar la petición HTTP al cancelar. */
const runControllers = new Map<string, AbortController>();

export interface EnqueueOptions {
  projectId: string;
  sessionId?: string | null;
  agentType: AgentType;
  triggeredBy: "user" | "system" | "agent";
  triggerRunId?: string | null;
  input: any;
}

const MAX_CONCURRENCY = 2;
let inFlight = 0;
let tickScheduled = false;

export async function enqueue(opts: EnqueueOptions): Promise<string> {
  const id = `run_${ulid().toLowerCase()}`;
  await db().insert(schema.agentRuns).values({
    id,
    projectId: opts.projectId,
    sessionId: opts.sessionId ?? null,
    agentType: opts.agentType,
    triggeredBy: opts.triggeredBy,
    triggerRunId: opts.triggerRunId ?? null,
    input: opts.input,
    status: "pending",
  });
  scheduleTick();
  return id;
}

export async function cancel(runId: string): Promise<boolean> {
  const rows = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  const r = rows[0];
  if (!r) return false;
  if (r.status === "running" || r.status === "pending") {
    await db()
      .update(schema.agentRuns)
      .set({ status: "cancelled", finishedAt: new Date().toISOString() })
      .where(eq(schema.agentRuns.id, runId));
    runControllers.get(runId)?.abort(); // corta la petición HTTP en vuelo
    return true;
  }
  return false;
}

/** Cancela toda la cola: cada run pendiente o en proceso (de todos los proyectos). */
export async function cancelAll(): Promise<number> {
  const res = await db()
    .update(schema.agentRuns)
    .set({ status: "cancelled", finishedAt: new Date().toISOString() })
    .where(inArray(schema.agentRuns.status, ["pending", "running"]))
    .returning({ id: schema.agentRuns.id });
  for (const c of runControllers.values()) c.abort();
  return res.length;
}

export async function applyRun(runId: string, apply: boolean): Promise<boolean> {
  const rows = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  const r = rows[0];
  if (!r || r.status !== "done") return false;
  if (apply) {
    const handler = HANDLERS[r.agentType as AgentType];
    if (handler?.apply) {
      try {
        await handler.apply(r.id, r.projectId, r.output);
      } catch (e: any) {
        await db()
          .update(schema.agentRuns)
          .set({ status: "failed", errorKind: "apply_error", errorMessage: String(e?.message ?? e) })
          .where(eq(schema.agentRuns.id, runId));
        return false;
      }
    }
    await db().update(schema.agentRuns).set({ status: "applied" }).where(eq(schema.agentRuns.id, runId));
  } else {
    await db().update(schema.agentRuns).set({ status: "discarded" }).where(eq(schema.agentRuns.id, runId));
  }
  return true;
}

export interface AgentHandler {
  run(runId: string, projectId: string, input: any, cfg: AppConfig): Promise<{
    output: any;
    tokensIn?: number;
    tokensOut?: number;
    modelRole?: string;
    modelName?: string;
    requiresGate?: boolean;
  }>;
  apply?(runId: string, projectId: string, output: any): Promise<void>;
}

const HANDLERS: Partial<Record<AgentType, AgentHandler>> = {
  documenter: { run: runDocumenter.run.bind(runDocumenter), apply: runDocumenter.apply.bind(runDocumenter) },
  planner: { run: runPlanner.run.bind(runPlanner), apply: runPlanner.apply.bind(runPlanner) },
  reindexer: { run: runReindexer.run },
  // coder/qa/fixer: orquestación rígida RETIRADA — ahora construye el agente builder único (executor).
  executor: { run: runExecutor.run.bind(runExecutor) },
  reconciler: { run: runReconciler.run.bind(runReconciler) },
  // packager: empaqueta la app de escritorio en un instalador NSIS bajo demanda (sin LLM).
  packager: { run: runPackager.run },
};

function scheduleTick(): void {
  if (tickScheduled) return;
  tickScheduled = true;
  setImmediate(() => {
    tickScheduled = false;
    tick().catch((e) => console.error("runner tick error", e));
  });
}

async function tick(): Promise<void> {
  while (inFlight < MAX_CONCURRENCY) {
    const candidates = await db()
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.status, "pending"))
      .orderBy(asc(schema.agentRuns.createdAt))
      .limit(1);
    const next = candidates[0];
    if (!next) return;
    const claimed = await db()
      .update(schema.agentRuns)
      .set({ status: "running" })
      .where(and(eq(schema.agentRuns.id, next.id), eq(schema.agentRuns.status, "pending")))
      .returning();
    if (claimed.length === 0) continue;
    inFlight++;
    void execute(next.id).finally(() => { inFlight--; scheduleTick(); });
  }
}

async function execute(runId: string): Promise<void> {
  const start = Date.now();
  const rows = await db().select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  const run = rows[0];
  if (!run) return;
  const handler = HANDLERS[run.agentType as AgentType];
  if (!handler) {
    await fail(runId, "internal", `Unknown agent type "${run.agentType}"`, start);
    return;
  }
  const cfg = await loadConfig();
  // AbortController por run: cancel()/cancelAll() lo abortan → corta la petición HTTP a LiteLLM.
  const controller = new AbortController();
  runControllers.set(runId, controller);
  try {
    const result = await llmContext.run(
      { signal: controller.signal, agentRunId: runId },
      () => withRetry(() => handler.run(runId, run.projectId, run.input, cfg)),
    );

    // Si se canceló mientras corría, respetar la cancelación: no pisar el estado ni aplicar.
    const fresh = await db()
      .select({ status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId));
    if (fresh[0]?.status === "cancelled") return;

    const requiresGate = !!result.requiresGate;

    // Save run output first
    await db()
      .update(schema.agentRuns)
      .set({
        status: requiresGate ? "done" : "running",
        output: result.output ?? null,
        tokensIn: result.tokensIn ?? 0,
        tokensOut: result.tokensOut ?? 0,
        modelRole: result.modelRole ?? null,
        modelName: result.modelName ?? null,
        durationMs: Date.now() - start,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.agentRuns.id, runId));

    if (!requiresGate && handler.apply) {
      try {
        await handler.apply(runId, run.projectId, result.output);
        await db()
          .update(schema.agentRuns)
          .set({ status: "applied" })
          .where(eq(schema.agentRuns.id, runId));
      } catch (e: any) {
        await db()
          .update(schema.agentRuns)
          .set({ status: "failed", errorKind: "apply_error", errorMessage: String(e?.message ?? e) })
          .where(eq(schema.agentRuns.id, runId));
      }
    } else if (!requiresGate) {
      await db()
        .update(schema.agentRuns)
        .set({ status: "applied" })
        .where(eq(schema.agentRuns.id, runId));
    }
  } catch (e: any) {
    // Si la excepción es por la cancelación (aborto), no la marques como "failed".
    const cur = await db()
      .select({ status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId));
    if (cur[0]?.status === "cancelled") return;
    await fail(runId, classify(e), String(e?.message ?? e), start);
  } finally {
    runControllers.delete(runId);
  }
}

function classify(e: any): string {
  const msg = String(e?.message ?? e);
  if (/timeout/i.test(msg)) return "timeout";
  if (/json|parse/i.test(msg)) return "validation_error";
  if (/llm|model|litellm/i.test(msg)) return "llm_error";
  return "internal";
}

async function fail(runId: string, kind: string, message: string, start: number): Promise<void> {
  await db()
    .update(schema.agentRuns)
    .set({ status: "failed", errorKind: kind, errorMessage: message, durationMs: Date.now() - start, finishedAt: new Date().toISOString() })
    .where(eq(schema.agentRuns.id, runId));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      const transient = /5\d\d|429|timeout|ECONN|fetch/i.test(String(e?.message ?? e));
      if (!transient || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

export function startBackgroundLoop(): void {
  scheduleTick();
  setInterval(scheduleTick, 5000).unref();
}
