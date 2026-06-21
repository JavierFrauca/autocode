import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Preferencias del usuario, persistidas en local (localStorage). v1: tema claro/oscuro. El tema se aplica
 * poniendo `data-theme` en <html>; los tokens viven en assets/tema.css. Por defecto en ESCRITORIO = oscuro.
 */
const KEY = "pref:tema";
const DEFAULT_OSCURO = true; // escritorio: oscuro por defecto
export type Tema = "claro" | "oscuro";

export const usePreferenciasStore = defineStore("preferencias", () => {
  const guardado = localStorage.getItem(KEY) as Tema | null;
  const tema = ref<Tema>(guardado ?? (DEFAULT_OSCURO ? "oscuro" : "claro"));

  function aplicar(): void {
    document.documentElement.dataset.theme = tema.value === "oscuro" ? "dark" : "light";
  }
  function set(t: Tema): void { tema.value = t; localStorage.setItem(KEY, t); aplicar(); }
  function alternar(): void { set(tema.value === "oscuro" ? "claro" : "oscuro"); }

  return { tema, aplicar, set, alternar };
});
