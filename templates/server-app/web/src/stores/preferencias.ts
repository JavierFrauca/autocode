import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Preferencias del usuario, persistidas en el navegador (localStorage). v1: tema claro/oscuro. El tema se
 * aplica poniendo `data-theme` en <html>; los tokens viven en assets/tema.css. Por defecto en WEB = claro.
 */
const KEY = "pref:tema";
const DEFAULT_OSCURO = false; // web: claro por defecto
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
