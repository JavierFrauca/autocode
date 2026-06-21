import { describe, expect, test } from "vitest";
import {
  applyDoneIds, markDone, parseDoneIds, pendingTasks, planToMarkdown, type SprintPlan,
} from "../agents/plan-md.js";

const plan = (): SprintPlan => ({
  app: { nombre: "Editor SEPA", tipo: "electron", descripcion: "x" },
  sprints: [
    { numero: 1, titulo: "Núcleo", objetivo: "o", tareas: [
      { id: "T-1-1", titulo: "Parsear pain.001", estado: "hecho" },
      { id: "T-1-2", titulo: "Modelo en memoria" },
    ] },
    { numero: 2, titulo: "UI", objetivo: "o", tareas: [
      { id: "T-2-1", titulo: "Lista de registros" },
    ] },
  ],
});

describe("plan vivo (plan.md)", () => {
  test("planToMarkdown pinta casillas según estado", () => {
    const md = planToMarkdown(plan());
    expect(md).toContain("- [x] `T-1-1` Parsear pain.001");
    expect(md).toContain("- [ ] `T-1-2` Modelo en memoria");
    expect(md).toContain("(1/2)"); // sprint 1: 1 de 2 hechas
  });

  test("parseDoneIds recupera los ids marcados (round-trip)", () => {
    const md = planToMarkdown(plan());
    expect(parseDoneIds(md)).toEqual(new Set(["T-1-1"]));
  });

  test("parseDoneIds respeta ediciones manuales del usuario", () => {
    const edited = [
      "## Sprint 1",
      "- [x] `T-1-1` Parsear",
      "- [x] `T-1-2` Modelo  (el usuario la marcó a mano)",
      "- [ ] `T-2-1` Lista",
    ].join("\n");
    expect(parseDoneIds(edited)).toEqual(new Set(["T-1-1", "T-1-2"]));
  });

  test("applyDoneIds sincroniza el estado por id y pendingTasks lo refleja", () => {
    const p = applyDoneIds(plan(), new Set(["T-1-2"])); // T-1-1 deja de estar hecha
    expect(p.sprints[0].tareas[0].estado).toBe("pendiente");
    expect(p.sprints[0].tareas[1].estado).toBe("hecho");
    expect(pendingTasks(p).map((t) => t.id)).toEqual(["T-1-1", "T-2-1"]);
  });

  test("markDone añade sin desmarcar lo ya hecho", () => {
    const p = markDone(plan(), ["T-1-2", "T-2-1"]);
    expect(pendingTasks(p)).toEqual([]); // todas hechas
    expect(p.sprints[0].tareas[0].estado).toBe("hecho"); // la que ya estaba sigue
  });
});
