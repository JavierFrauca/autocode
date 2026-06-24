import { db, schema } from "../db/client.js";
import { log } from "../log.js";
import { nucleusIndexAll, nucleusIsEmpty } from "./client.js";
import { kbDirs } from "./kb.js";
import type { ProjectRef } from "./indexer.js";

/**
 * Al arrancar: si la BBDD de Nucleus NO existe o NO contiene datos, se lanza un indexado DIFERIDO de
 * todo el contenido de los desarrollos (los proyectos en sqlite → sus carpetas de documentos). Corre en
 * el worker, así que la 1ª descarga del modelo de embeddings (~450 MB) y el trabajo de CPU no congelan
 * la UI. Es idempotente: si ya hay datos, no hace nada.
 */
export async function maybeIndexNucleusOnStartup(): Promise<void> {
  let empty: boolean;
  try {
    empty = await nucleusIsEmpty();
  } catch (e) {
    log.warn("nucleus", "no se pudo comprobar el estado de la BBDD; salto el indexado", { err: e });
    return;
  }
  if (!empty) {
    log.info("nucleus", "la BBDD ya tiene datos → no reindexo");
    return;
  }

  let projects: ProjectRef[] = [];
  try {
    const rows = await db()
      .select({ id: schema.projects.id, name: schema.projects.name, rootPath: schema.projects.rootPath })
      .from(schema.projects);
    projects = rows.map((r) => ({ id: r.id, name: r.name, rootPath: r.rootPath }));
  } catch (e) {
    log.warn("nucleus", "no se pudieron leer los proyectos para indexar", { err: e });
    return;
  }
  if (projects.length === 0) {
    log.info("nucleus", "BBDD vacía y sin proyectos → nada que indexar");
    return;
  }

  log.info("nucleus", `BBDD vacía → indexado diferido de ${projects.length} proyecto(s) + catálogos…`);
  try {
    const res = await nucleusIndexAll(projects, kbDirs());
    log.info("nucleus", "indexado diferido completo", res);
  } catch (e) {
    log.warn("nucleus", "el indexado diferido falló", { err: e });
  }
}
