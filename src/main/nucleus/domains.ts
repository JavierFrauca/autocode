/**
 * Mapeo de "qué se indexa" → dominio de Nucleus. Helpers puros (sin nativo), compartidos por el
 * proceso main y el worker. Un dominio por proyecto, y dos dominios para los catálogos transversales.
 */
export function projectDomain(projectId: string): string {
  return `proj:${projectId}`;
}

export const KB_LIBRARY_DOMAIN = "kb:library";
export const KB_TEMPLATES_DOMAIN = "kb:templates";

/** Compat con el viejo parámetro `collection` de `ingestRevision`. */
export function domainForCollection(projectId: string, collection: string): string {
  if (collection === "__library__") return KB_LIBRARY_DOMAIN;
  if (collection === "__templates__") return KB_TEMPLATES_DOMAIN;
  return projectDomain(projectId);
}
