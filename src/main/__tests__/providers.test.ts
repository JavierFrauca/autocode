import { describe, expect, it } from "vitest";
import type { AppConfig } from "@shared";
import { PROVIDERS, resolveBaseUrl } from "../llm/providers.js";

function cfgWith(generation: Partial<AppConfig["generation"]>): AppConfig {
  return {
    generation: {
      mode: "cloud", provider: "anthropic", baseUrl: "", apiKey: "", mainModel: "", fastModel: "",
      ...generation,
    },
    projectsRoot: "",
    qdrantUrl: "http://localhost:6333",
  };
}

describe("resolveBaseUrl", () => {
  it("cloud: usa la raíz del preset e ignora la baseUrl guardada", () => {
    const cfg = cfgWith({ mode: "cloud", provider: "deepseek", baseUrl: "http://lo-que-sea" });
    expect(resolveBaseUrl(cfg)).toBe("https://api.deepseek.com");
  });

  it("local: usa la URL del usuario", () => {
    const cfg = cfgWith({ mode: "local", provider: "local", baseUrl: "http://192.168.1.38:4000" });
    expect(resolveBaseUrl(cfg)).toBe("http://192.168.1.38:4000");
  });

  it("local sin URL → cadena vacía", () => {
    const cfg = cfgWith({ mode: "local", provider: "local", baseUrl: "" });
    expect(resolveBaseUrl(cfg)).toBe("");
  });
});

describe("PROVIDERS", () => {
  it("todas las raíces cloud son https y sin /v1 (lo añade clientFor)", () => {
    for (const p of Object.values(PROVIDERS)) {
      if (p.tier !== "cloud") continue;
      expect(p.root).toMatch(/^https:\/\//);
      expect(p.root.endsWith("/v1")).toBe(false);
    }
  });

  it("el preset local no trae raíz (la pone el usuario)", () => {
    expect(PROVIDERS.local.root).toBe("");
    expect(PROVIDERS.local.tier).toBe("local");
  });
});
