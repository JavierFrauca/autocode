/**
 * Plan de desarrollo como **documento vivo** en `planes/plan.md`: una lista de tareas con
 * casillas `- [ ]` / `- [x]`. El usuario puede editarlo (marcar/desmarcar tareas) y AutoCode lo
 * respeta en la siguiente construcción. El estado canónico vive en `planJson` (BD); el .md es la
 * vista editable. Estas funciones son PURAS para poder testearlas.
 */

export interface SprintTask {
  id: string;
  titulo: string;
  capa?: string;
  role?: string;
  recibe?: string[];
  produce?: string[];
  verificacion?: string;
  estado?: "pendiente" | "hecho";
}

export interface Sprint {
  numero: number;
  titulo: string;
  objetivo: string;
  tareas: SprintTask[];
}

export interface SprintPlan {
  app: { nombre: string; tipo: string; descripcion: string };
  sprints: Sprint[];
}

/** Ruta relativa del plan vivo dentro del proyecto. */
export const PLAN_MD_REL = "planes/plan.md";

export function isDone(t: SprintTask): boolean {
  return t.estado === "hecho";
}

/** Render del plan a Markdown con casillas. El `id` va en backticks para poder re-parsearlo. */
export function planToMarkdown(plan: SprintPlan): string {
  const lines: string[] = [
    `# Plan de desarrollo: ${plan.app?.nombre ?? ""}`,
    ``,
    `**Tipo:** ${plan.app?.tipo ?? ""}`,
    `**Descripción:** ${plan.app?.descripcion ?? ""}`,
    ``,
    `> Marca \`[x]\` una tarea para darla por hecha, o \`[ ]\` para que se rehaga. ` +
      `AutoCode respeta tus cambios en la siguiente construcción.`,
    ``,
  ];
  for (const sprint of plan.sprints ?? []) {
    const tareas = sprint.tareas ?? [];
    const done = tareas.filter(isDone).length;
    lines.push(`## Sprint ${sprint.numero}: ${sprint.titulo}  (${done}/${tareas.length})`);
    if (sprint.objetivo) lines.push(``, `**Objetivo:** ${sprint.objetivo}`);
    lines.push(``);
    for (const t of tareas) {
      lines.push(`- [${isDone(t) ? "x" : " "}] \`${t.id}\` ${t.titulo}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

/** Lee un plan.md (posiblemente editado a mano) y devuelve los ids marcados como hechos. */
export function parseDoneIds(md: string): Set<string> {
  const done = new Set<string>();
  const re = /^\s*[-*]\s*\[([ xX])\]\s*`([^`]+)`/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m[1].toLowerCase() === "x") done.add(m[2].trim());
  }
  return done;
}

/** Aplica el estado (hecho/pendiente) por id sobre las tareas del plan. Muta y devuelve el plan. */
export function applyDoneIds(plan: SprintPlan, doneIds: Set<string>): SprintPlan {
  for (const s of plan.sprints ?? []) {
    for (const t of s.tareas ?? []) {
      t.estado = doneIds.has(t.id) ? "hecho" : "pendiente";
    }
  }
  return plan;
}

/** Marca como hechas las tareas indicadas (unión con las ya hechas). Muta y devuelve el plan. */
export function markDone(plan: SprintPlan, ids: Iterable<string>): SprintPlan {
  const set = new Set(ids);
  for (const s of plan.sprints ?? []) {
    for (const t of s.tareas ?? []) {
      if (set.has(t.id)) t.estado = "hecho";
    }
  }
  return plan;
}

export function pendingTasks(plan: SprintPlan): SprintTask[] {
  return (plan.sprints ?? []).flatMap((s) => s.tareas ?? []).filter((t) => !isDone(t));
}

export function allTaskIds(plan: SprintPlan): string[] {
  return (plan.sprints ?? []).flatMap((s) => (s.tareas ?? []).map((t) => t.id));
}
