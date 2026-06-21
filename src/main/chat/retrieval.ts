import type { AppConfig } from "@shared";
import { searchDocuments } from "../tools/knowledge.js";
import { log } from "../log.js";

/**
 * Auto-RAG para el chat: recupera los fragmentos más relevantes de los papers del
 * proyecto para la pregunta del usuario y los devuelve como un bloque de contexto
 * listo para inyectar en el system. Funciona con CUALQUIER modelo (no necesita tools).
 * Si no hay embeddings, no hay hits, o falla la búsqueda, devuelve null (degradación silenciosa).
 */
export async function buildProjectContext(
  cfg: AppConfig,
  projectId: string,
  query: string,
  topK = 6,
): Promise<string | null> {
  // Embeddings locales siempre disponibles; solo evitamos gastar uno en saludos / mensajes triviales.
  if (query.trim().length < 8) return null;

  let res;
  try {
    res = await searchDocuments({ query, projectId, topK }, cfg);
  } catch (e) {
    log.warn("chat.rag", "búsqueda falló; respondo sin contexto de documentos", { err: e, projectId });
    return null;
  }
  if (!res.ok) {
    log.warn("chat.rag", "RAG omitido", { reason: res.error, projectId });
    return null;
  }
  if (res.hits.length === 0) return null;

  const blocks = res.hits.map((h, i) => {
    const head = [h.title, Array.isArray(h.heading) ? h.heading.join(" › ") : h.heading]
      .filter(Boolean)
      .join(" — ");
    const ref = h.path ? ` (${h.path})` : "";
    return `[[${i + 1}]] ${head}${ref}\n${h.text.trim()}`;
  });

  return (
    "Contexto recuperado de los documentos de este proyecto (úsalo si es relevante; " +
    "cita la fuente con su número [[n]] cuando lo emplees; si no es relevante, ignóralo):\n\n" +
    blocks.join("\n\n---\n\n")
  );
}
