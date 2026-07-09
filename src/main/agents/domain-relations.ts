/**
 * Coherencia de relaciones entre entidades de `dominios/`. El documenter tiene instrucción de reflejar
 * cada relación en AMBOS ficheros ("Si dos entidades se relacionan, refleja la relación en AMBOS
 * ficheros"), pero nada comprobaba que de verdad pasara. Heurístico (coincidencia de nombre) y de
 * AVISO, no de bloqueo — sirve para que el agente constructor (o quien lea `listar_dominios`) sepa que
 * hay un posible hueco en la documentación del modelo de datos, no para impedir nada.
 */

export interface DomainDoc {
  /** Slug del fichero (dominios/<slug>.md → slug), p.ej. "cliente". */
  slug: string;
  /** Cuerpo completo del fichero (Campos + Relaciones + Diagrama, o lo que traiga). */
  body: string;
}

export interface RelationWarning {
  desde: string;
  hacia: string;
  mensaje: string;
}

/** Nombre "humano" de la entidad a partir de su slug (cliente → Cliente, linea-pedido → Linea Pedido). */
export function displayName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

/** Extrae el contenido de la sección "## Relaciones" (hasta el siguiente "## " o el final del fichero). */
function relacionesSection(body: string): string {
  const m = body.match(/##\s*Relaciones\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  return m ? m[1] : "";
}

/** ¿El texto menciona el nombre de la entidad como palabra (insensible a mayúsculas, plural simple con "s")? */
function mentionsEntity(text: string, nombre: string): boolean {
  const esc = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}s?\\b`, "i").test(text);
}

/**
 * Relaciones declaradas en UN SOLO SENTIDO: la entidad A menciona a B en su sección de Relaciones, pero
 * el fichero de B no menciona a A en ningún sitio. Solo mira dentro de `## Relaciones` de origen (para no
 * disparar por coincidencias casuales en Campos/Diagrama) pero busca el nombre de vuelta en el fichero
 * COMPLETO de B (puede estar en su prosa, no solo en su propia sección de Relaciones).
 */
export function findOneSidedRelations(entities: DomainDoc[]): RelationWarning[] {
  const warnings: RelationWarning[] = [];

  for (const a of entities) {
    const relSection = relacionesSection(a.body);
    if (!relSection.trim()) continue;
    const nombreA = displayName(a.slug);

    for (const b of entities) {
      if (b.slug === a.slug) continue;
      const nombreB = displayName(b.slug);
      if (!mentionsEntity(relSection, nombreB)) continue;
      if (mentionsEntity(b.body, nombreA)) continue;
      warnings.push({
        desde: nombreA,
        hacia: nombreB,
        mensaje:
          `${nombreA} menciona una relación con ${nombreB} en sus Relaciones, pero ${nombreB} no menciona ` +
          `a ${nombreA} en ningún sitio — revisa si falta reflejar la relación en ambos ficheros.`,
      });
    }
  }
  return warnings;
}
