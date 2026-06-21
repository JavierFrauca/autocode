import type { FastifyInstance } from "fastify";
import { getPromptRaw, listPrompts, resetPromptOverride, savePromptOverride } from "../prompts.js";

function safeName(raw: string): string | null {
  return /^[a-zA-Z0-9_-]+$/.test(raw) ? raw : null;
}

export async function registerPromptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/prompts", async () => {
    return { prompts: await listPrompts() };
  });

  app.get("/api/prompts/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const safe = safeName(name);
    if (!safe) return reply.code(400).send({ error: "invalid name" });
    try {
      return await getPromptRaw(safe);
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.put("/api/prompts/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const safe = safeName(name);
    if (!safe) return reply.code(400).send({ error: "invalid name" });
    const { content } = (req.body ?? {}) as { content?: string };
    if (typeof content !== "string") return reply.code(400).send({ error: "content required" });
    await savePromptOverride(safe, content);
    return { ok: true };
  });

  app.post("/api/prompts/:name/reset", async (req, reply) => {
    const { name } = req.params as { name: string };
    const safe = safeName(name);
    if (!safe) return reply.code(400).send({ error: "invalid name" });
    await resetPromptOverride(safe);
    try {
      return { ok: true, ...(await getPromptRaw(safe)) };
    } catch {
      return { ok: true, content: "", isCustom: false, defaultContent: "" };
    }
  });
}
