import { describe, it, expect } from "vitest";
import { thinkingParams } from "../llm/thinking.js";

const cfg = (provider: string): any => ({ generation: { provider } });

describe("thinkingParams — el flag de thinking SOLO a proveedores directos", () => {
  it("undefined → no manda nada (sea cual sea el proveedor)", () => {
    expect(thinkingParams(cfg("deepseek"), undefined)).toEqual({});
    expect(thinkingParams(cfg("local"), undefined)).toEqual({});
  });

  it("local (LiteLLM/Ollama) → NUNCA manda el flag, aunque se pida", () => {
    expect(thinkingParams(cfg("local"), false)).toEqual({});
    expect(thinkingParams(cfg("local"), "high")).toEqual({});
    expect(thinkingParams(cfg("local"), "max")).toEqual({});
  });

  it("deepseek directo: false → thinking disabled", () => {
    expect(thinkingParams(cfg("deepseek"), false)).toEqual({ thinking: { type: "disabled" } });
  });

  it("deepseek directo: true/high → enabled high; max → enabled max", () => {
    const high = { thinking: { type: "enabled" }, reasoning_effort: "high" };
    expect(thinkingParams(cfg("deepseek"), true)).toEqual(high);
    expect(thinkingParams(cfg("deepseek"), "high")).toEqual(high);
    expect(thinkingParams(cfg("deepseek"), "max")).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "max" });
  });

  it("proveedor directo aún sin mapear (openai) → todavía no manda nada (evita 400)", () => {
    expect(thinkingParams(cfg("openai"), "high")).toEqual({});
  });
});
