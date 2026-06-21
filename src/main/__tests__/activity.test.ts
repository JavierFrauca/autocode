import { describe, expect, test } from "vitest";
import { cancelCall, getActivity, getCalls, startCall } from "../llm/activity.js";

describe("anillo de actividad LLM", () => {
  test("startCall registra running; done/fail actualizan su propia entrada", () => {
    const t1 = startCall({ model: "m1", role: "chat", source: "chat" });
    const t2 = startCall({ model: "m2", role: "code", source: "coder", agentRunId: "run_x" });

    let calls = getCalls();
    expect(calls.find((c) => c.model === "m1")?.status).toBe("running");
    expect(calls.find((c) => c.model === "m2")?.status).toBe("running");

    // dos llamadas concurrentes coexisten (no se pisan como el current/last anterior)
    expect(calls.filter((c) => c.status === "running").length).toBeGreaterThanOrEqual(2);

    t1.done({ tokensIn: 10, tokensOut: 5 });
    t2.fail("boom");

    calls = getCalls();
    const c1 = calls.find((c) => c.model === "m1");
    const c2 = calls.find((c) => c.model === "m2");
    expect(c1?.status).toBe("done");
    expect(c1?.tokensIn).toBe(10);
    expect(c2?.status).toBe("failed");
    expect(c2?.error).toBe("boom");
  });

  test("agentRunId distingue llamadas de agente de las de chat/embeddings", () => {
    startCall({ model: "e", role: "embeddings", source: "knowledge-search" }); // sin agentRunId
    const noAgent = getCalls().filter((c) => !c.agentRunId);
    expect(noAgent.some((c) => c.source === "knowledge-search")).toBe(true);
    // las de agente llevan su runId
    expect(getCalls().some((c) => c.agentRunId === "run_x")).toBe(true);
  });

  test("getActivity da compatibilidad current/last", () => {
    const a = getActivity();
    expect(a).toHaveProperty("current");
    expect(a).toHaveProperty("last");
  });

  test("attachCancel hace la llamada cancelable; cancelCall la aborta una sola vez", () => {
    const t = startCall({ model: "emb", role: "embeddings", source: "knowledge-search" });
    let aborts = 0;
    t.attachCancel(() => { aborts++; });

    const entry = getCalls().find((c) => c.model === "emb");
    expect(entry?.cancellable).toBe(true);

    expect(cancelCall(entry!.id)).toBe(true);
    expect(aborts).toBe(1);
    // segunda vez ya no hay nada que abortar
    expect(cancelCall(entry!.id)).toBe(false);
    expect(aborts).toBe(1);
  });

  test("al terminar deja de ser cancelable", () => {
    const t = startCall({ model: "emb2", role: "embeddings", source: "ingest" });
    t.attachCancel(() => {});
    t.done({ tokensIn: 1 });
    const entry = getCalls().find((c) => c.model === "emb2");
    expect(entry?.cancellable).toBe(false);
    expect(cancelCall(entry!.id)).toBe(false);
  });
});
