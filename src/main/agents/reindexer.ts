import { and, desc, eq } from "drizzle-orm";
import type { AppConfig } from "@shared";
import { EMBEDDINGS_DIM, EMBEDDINGS_MODEL } from "@shared";
import { db, schema } from "../db/client.js";
import { QdrantClient } from "../qdrant/client.js";
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

    const qdrant = new QdrantClient(cfg.qdrantUrl);
    try { await qdrant.deleteCollection(project.qdrantCollection); } catch {}
    await qdrant.ensureCollection(project.qdrantCollection, EMBEDDINGS_DIM);

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
    return { output, modelRole: "embeddings", modelName: EMBEDDINGS_MODEL, requiresGate: false };
  },
};
