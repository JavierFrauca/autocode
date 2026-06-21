import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { chat } from "../llm/client.js";

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:projectId/sessions", async (req) => {
    const { projectId } = req.params as { projectId: string };
    return db()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.projectId, projectId))
      .orderBy(desc(schema.sessions.createdAt));
  });

  app.post("/api/projects/:projectId/sessions", async (req) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body as any) ?? {};
    const id = `sess_${ulid().toLowerCase()}`;
    const inserted = await db()
      .insert(schema.sessions)
      .values({ id, projectId, title: body.title ?? null })
      .returning();
    return inserted[0];
  });

  app.get("/api/sessions/:sessionId/messages", async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return db()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(schema.messages.createdAt);
  });

  const RenameSchema = z.object({ title: z.string().min(1).max(120).nullable() });
  app.put("/api/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await db()
      .update(schema.sessions)
      .set({ title: parsed.data.title })
      .where(eq(schema.sessions.id, sessionId))
      .returning();
    if (!updated[0]) return reply.code(404).send({ error: "session not found" });
    return updated[0];
  });

  app.post("/api/sessions/:sessionId/suggest-title", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const force = !!(req.body as any)?.force;
    const sessions = await db().select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    const session = sessions[0];
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (session.title && !force) return { title: session.title, kept: true };

    const msgs = await db()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, sessionId))
      .orderBy(asc(schema.messages.createdAt))
      .limit(6);
    if (msgs.length === 0) return reply.code(400).send({ error: "session is empty" });

    const cfg = await loadConfig();
    const transcript = msgs.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 2000);

    let title: string | null = null;
    try {
      const r = await chat(
        cfg, "cheap",
        [
          { role: "system", content: "Da un título corto (3-7 palabras, idioma del usuario, sin comillas, sin punto final) a esta conversación. Responde SOLO con el título." },
          { role: "user", content: transcript },
        ],
        { temperature: 0.3, maxTokens: 40 },
        "session-title",
      );
      title = r.content.trim().replace(/^["'`]+|["'`.]+$/g, "").slice(0, 120) || null;
    } catch (e: any) {
      return reply.code(502).send({ error: String(e?.message ?? e) });
    }

    if (title) {
      await db().update(schema.sessions).set({ title }).where(eq(schema.sessions.id, sessionId));
    }
    return { title };
  });
}

export async function maybeSuggestSessionTitle(sessionId: string, log: any): Promise<void> {
  try {
    const sessions = await db().select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    const session = sessions[0];
    if (!session || session.title) return;
    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId));
    if (msgs.length < 2) return;
    const cfg = await loadConfig();
    const transcript = msgs.slice(0, 6).map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 2000);
    const r = await chat(
      cfg, "cheap",
      [
        { role: "system", content: "Da un título corto (3-7 palabras, idioma del usuario, sin comillas, sin punto final) a esta conversación. Responde SOLO con el título." },
        { role: "user", content: transcript },
      ],
      { temperature: 0.3, maxTokens: 40 },
      "session-title",
    );
    const title = r.content.trim().replace(/^["'`]+|["'`.]+$/g, "").slice(0, 120);
    if (title) {
      await db().update(schema.sessions).set({ title }).where(eq(schema.sessions.id, sessionId));
    }
  } catch (e: any) {
    log?.warn?.({ err: e }, "auto-suggest title failed");
  }
}
