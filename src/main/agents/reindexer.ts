import { and, desc, eq } from "drizzle-orm";
import type { AppConfig } from "@shared";
import { db, schema } from "../db/client.js";
import { ingestRevision } from "../papers/ingest.js";

interface ReindexerOutput {
  documents: number;
  chunks: number;
}

export const runReindexer = {
  async run(_runId: string, projectId: string, _input: unknown, cfg: AppConfig) {
    const project = (await db()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId)))[0];
    if (!project) throw new Error("project not found");

    // Nucleus reindexa por documento de forma idempotente (borra el previo por `source`). No hay que
    // recrear ninguna "colección": basta reingestar la última revisión de cada documento.
    const docs = await db()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.projectId, projectId));

    let chunks = 0;
    let count = 0;
    for (const doc of docs) {
      const revs = await db()
        .select()
        .from(schema.documentRevisions)
        .where(
          and(
            eq(schema.documentRevisions.documentId, doc.id),
            eq(schema.documentRevisions.projectId, projectId),
          ),
        )
        .orderBy(desc(schema.documentRevisions.createdAt))
        .limit(1);
      const rev = revs[0];
      if (!rev) continue;
      const n = await ingestRevision(
        cfg,
        projectId,
        project.qdrantCollection,
        doc.id,
        rev.id,
        doc.path,
        doc.title,
        rev.body,
      );
      chunks += n;
      count++;
    }
    const output: ReindexerOutput = { documents: count, chunks };
    return { output, modelRole: "embeddings", modelName: "nucleus (multilingual-e5-small)", requiresGate: false };
  },
};
