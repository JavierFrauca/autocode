import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import {
  classify,
  extractText,
  fetchUrlAsMarkdown,
  saveReferenceDoc,
  saveResource,
  saveTechnicalDoc,
  summarizeConclusions,
} from "../attachments.js";

const MAX_FILE = 30 * 1024 * 1024;

export async function registerAttachRoutes(app: FastifyInstance): Promise<void> {
  // Adjuntar un fichero desde el chat. Imágenes → Recursos; texto/PDF/docx → Documentos (DOC-).
  app.post("/api/projects/:id/attach", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await req.file({ limits: { fileSize: MAX_FILE } });
    if (!data) return reply.code(400).send({ error: "no se recibió ningún archivo" });

    const kind = classify(data.filename);
    if (!kind) return reply.code(400).send({ error: `tipo de archivo no soportado: ${path.extname(data.filename) || "?"}` });

    const buffer = await data.toBuffer();
    if (kind === "resource") {
      const saved = await saveResource(id, data.filename, buffer);
      return { kind: "resource", name: saved.name, projectPath: saved.projectPath };
    }

    const text = await extractText(data.filename, buffer);
    const name = path.basename(data.filename, path.extname(data.filename));

    // ¿El usuario lo marcó como DOCUMENTO TÉCNICO? (fuente canónica a destilar). Flag por query para no
    // depender del orden de los campos multipart.
    const q = req.query as { tecnico?: string; tema?: string };
    if (q.tecnico === "1" || q.tecnico === "true") {
      const t = await saveTechnicalDoc({ projectId: id, name, source: data.filename, rawMarkdown: text, tema: q.tema });
      return { kind: "technical", name: t.title, projectPath: t.path };
    }

    const r = await saveReferenceDoc({ projectId: id, name, body: text, source: data.filename });
    return { kind: "document", name: r.title, projectPath: r.path };
  });

  // Adjuntar una URL: se descarga, se canoniza y se guarda. Si `tecnico`, se destila a documento técnico;
  // si no, se resume en "conclusiones" y se guarda como referencia aportada.
  const UrlSchema = z.object({ url: z.string().min(4), tecnico: z.boolean().optional(), tema: z.string().optional() });
  app.post("/api/projects/:id/attach-url", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UrlSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "falta la URL" });

    let extracted: { title: string; markdown: string };
    try {
      extracted = await fetchUrlAsMarkdown(parsed.data.url);
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? "no se pudo abrir el enlace" });
    }

    if (parsed.data.tecnico) {
      const t = await saveTechnicalDoc({
        projectId: id, name: extracted.title, source: parsed.data.url, rawMarkdown: extracted.markdown, tema: parsed.data.tema,
      });
      return { kind: "technical", name: t.title, projectPath: t.path, source: parsed.data.url };
    }

    const cfg = await loadConfig();
    const conclusions = await summarizeConclusions(cfg, parsed.data.url, extracted.markdown);
    const body = [
      conclusions ?? "",
      "## Contenido de la página",
      extracted.markdown,
    ].filter(Boolean).join("\n\n");

    const r = await saveReferenceDoc({ projectId: id, name: extracted.title, body, source: parsed.data.url });
    return { kind: "document", name: r.title, projectPath: r.path, source: parsed.data.url };
  });
}
