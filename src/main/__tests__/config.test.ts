import { describe, expect, it } from "vitest";
import type { AppConfig } from "@shared";
import { DEFAULT_CONFIG, isConfigured, mergeWithDefaults } from "../config.js";

describe("isConfigured", () => {
  it("returns false for the default empty config", () => {
    expect(isConfigured(DEFAULT_CONFIG)).toBe(false);
  });

  it("cloud: true with apiKey + both models + projectsRoot", () => {
    const cfg: AppConfig = {
      ...DEFAULT_CONFIG,
      generation: {
        mode: "cloud", provider: "anthropic", baseUrl: "", apiKey: "sk-ant-x",
        mainModel: "claude-sonnet-4-6", fastModel: "claude-haiku-4-5",
      },
      projectsRoot: "/tmp/p",
    };
    expect(isConfigured(cfg)).toBe(true);
  });

  it("cloud: false without apiKey", () => {
    const cfg: AppConfig = {
      ...DEFAULT_CONFIG,
      generation: { mode: "cloud", provider: "openai", baseUrl: "", apiKey: "", mainModel: "m", fastModel: "f" },
      projectsRoot: "/tmp/p",
    };
    expect(isConfigured(cfg)).toBe(false);
  });

  it("local: true with baseUrl + both models (no apiKey needed)", () => {
    const cfg: AppConfig = {
      ...DEFAULT_CONFIG,
      generation: {
        mode: "local", provider: "local", baseUrl: "http://192.168.1.38:4000", apiKey: "",
        mainModel: "qwen3-coder-30b", fastModel: "qwen2.5-3b",
      },
      projectsRoot: "/tmp/p",
    };
    expect(isConfigured(cfg)).toBe(true);
  });

  it("false when the fast model is missing", () => {
    const cfg: AppConfig = {
      ...DEFAULT_CONFIG,
      generation: { mode: "cloud", provider: "anthropic", baseUrl: "", apiKey: "k", mainModel: "m", fastModel: "" },
      projectsRoot: "/tmp/p",
    };
    expect(isConfigured(cfg)).toBe(false);
  });
});

describe("mergeWithDefaults — migración de config vieja", () => {
  it("migra litellm + models a un preset local de generación", () => {
    const legacy = {
      litellm: { baseUrl: "http://192.168.1.38:4000", apiKey: "sk-local" },
      models: {
        chat: { model: "qwen3-32b" },
        code: { model: "qwen3-coder-30b" },
        cheap: { model: "qwen2.5-3b" },
        docs: { model: "qwen2.5-coder-7b" },
        embeddings: { model: "bge-m3", dim: 1024 },
      },
      embeddingsBaseUrl: "",
      projectsRoot: "/tmp/p",
      qdrantUrl: "http://localhost:6333",
    };
    const cfg = mergeWithDefaults(legacy);
    expect(cfg.generation.mode).toBe("local");
    expect(cfg.generation.provider).toBe("local");
    expect(cfg.generation.baseUrl).toBe("http://192.168.1.38:4000");
    expect(cfg.generation.apiKey).toBe("sk-local");
    // El modelo de código (el más potente) pasa a ser el principal.
    expect(cfg.generation.mainModel).toBe("qwen3-coder-30b");
    expect(cfg.generation.fastModel).toBe("qwen2.5-3b");
    expect(cfg.projectsRoot).toBe("/tmp/p");
    expect((cfg as unknown as Record<string, unknown>).litellm).toBeUndefined();
    expect((cfg as unknown as Record<string, unknown>).models).toBeUndefined();
  });

  it("deja intacta una config nueva (con generation)", () => {
    const fresh = {
      generation: {
        mode: "cloud", provider: "deepseek", baseUrl: "", apiKey: "sk",
        mainModel: "deepseek-chat", fastModel: "deepseek-chat",
      },
      projectsRoot: "/tmp/q",
      qdrantUrl: "http://localhost:6333",
    };
    const cfg = mergeWithDefaults(fresh);
    expect(cfg.generation.provider).toBe("deepseek");
    expect(cfg.generation.mainModel).toBe("deepseek-chat");
  });
});
