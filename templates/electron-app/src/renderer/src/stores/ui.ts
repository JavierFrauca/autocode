import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Estado de la cáscara (shell): si el menú lateral está colapsado. Es estado de UI puro; el dominio
 * va en sus propios stores. El agente puede añadir aquí preferencias de interfaz (tema, densidad…).
 */
export const useUiStore = defineStore("ui", () => {
  const sidebarColapsado = ref(false);
  function alternarSidebar(): void {
    sidebarColapsado.value = !sidebarColapsado.value;
  }
  return { sidebarColapsado, alternarSidebar };
});
