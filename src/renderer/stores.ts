import { defineStore } from "pinia";
import type { AppType } from "@shared";
import { api } from "./api";

export const useAppStore = defineStore("app", {
  state: () => ({
    health: null as any,
    projects: [] as any[],
    currentProjectId: null as string | null,
    llmActivity: null as any,
    theme: (localStorage.getItem("autocode-theme") ?? "light") as "light" | "dark",
    // Generación en curso por proyecto — vive en el store para sobrevivir a la navegación.
    generations: {} as Record<
      string,
      { runId: string; status: "running" | "done" | "failed"; error: string | null }
    >,
    // Visor de actividad LiteLLM (panel global)
    llmPanelOpen: false,
  }),
  actions: {
    async refreshHealth() {
      this.health = await api.health();
    },
    async refreshLlmActivity() {
      try { this.llmActivity = await api.llmActivity(); } catch {}
    },
    async refreshProjects() {
      this.projects = await api.projects();
    },
    setCurrentProject(id: string) {
      this.currentProjectId = id;
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      localStorage.setItem("autocode-theme", this.theme);
    },
    toggleLlmPanel() {
      this.llmPanelOpen = !this.llmPanelOpen;
    },

    /**
     * Arranca (o sigue) la generación del plan para un proyecto. El bucle de polling vive
     * aquí, no en el componente, así que si el usuario navega a otra pantalla y vuelve, el
     * estado se conserva. Idempotente: si ya hay una en curso, no arranca otra.
     */
    async startGeneration(projectId: string, appType: AppType) {
      if (this.generations[projectId]?.status === "running") return;
      this.generations[projectId] = { runId: "", status: "running", error: null };
      try {
        const r = await api.generatePlan(projectId, appType);
        if (!this.generations[projectId]) return; // cancelada mientras tanto
        this.generations[projectId].runId = r.runId;
        // El planner AGÉNTICO con un modelo de RAZONAMIENTO hace varias llamadas (consultar docs +
        // biblioteca + JSON final) → puede tardar varios minutos. Sondeamos por ESTADO del run con un tope
        // generoso (20 min); el backend TERMINA y GUARDA el plan aunque la UI deje de mirar antes (por eso
        // al recargar aparecía con el límite viejo de 3,75 min).
        const deadline = Date.now() + 20 * 60_000;
        while (Date.now() < deadline) {
          await new Promise((res) => setTimeout(res, 2500));
          if (this.generations[projectId]?.status !== "running") return;
          let run: any;
          try { run = await api.agentRun(r.runId); } catch { continue; }
          if (run.status === "done" || run.status === "applied") {
            this.generations[projectId] = { runId: r.runId, status: "done", error: null };
            return;
          }
          if (run.status === "failed" || run.status === "cancelled") {
            this.generations[projectId] = {
              runId: r.runId,
              status: "failed",
              error: run.errorMessage ?? "La generación no pudo completarse",
            };
            return;
          }
        }
        // Tope alcanzado y el run SIGUE en marcha: no es un fallo duro — sigue por detrás y aparecerá al
        // recargar. Mensaje claro en vez del confuso "Tiempo de espera agotado".
        this.generations[projectId] = {
          runId: r.runId,
          status: "failed",
          error: "Está tardando más de lo normal (modelo de razonamiento). Sigue trabajando por detrás; recarga la pantalla en un momento para ver el plan.",
        };
      } catch (e: any) {
        this.generations[projectId] = { runId: "", status: "failed", error: e?.message ?? String(e) };
      }
    },
    clearGeneration(projectId: string) {
      delete this.generations[projectId];
    },
  },
});
