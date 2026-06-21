import type { FastifyInstance } from "fastify";
import { pingDb } from "../db/client.js";
import { loadConfig, isConfigured } from "../config.js";
import { pingProvider } from "../llm/client.js";
import { getActivity } from "../llm/activity.js";
import { QdrantClient } from "../qdrant/client.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    const cfg = await loadConfig().catch(() => null);
    const db = await pingDb();
    const provider = cfg ? await pingProvider(cfg) : false;
    const qdrant = cfg ? await new QdrantClient(cfg.qdrantUrl).ping() : false;
    return {
      ok: db,
      configured: cfg ? isConfigured(cfg) : false,
      services: { db, provider, qdrant },
      mode: process.env.AUTOCODE_MODE ?? "desktop",
      llm: getActivity(),
    };
  });

  // Endpoint ligero, sin pings externos, para refrescar el indicador LLM en la status bar.
  app.get("/api/llm-activity", async () => getActivity());
}
