import { defineStore } from "pinia";
import { ref } from "vue";

/** Estado de la cáscara (shell): si el menú lateral está colapsado. Estado de UI puro. */
export const useUiStore = defineStore("ui", () => {
  const sidebarColapsado = ref(false);
  function alternarSidebar(): void {
    sidebarColapsado.value = !sidebarColapsado.value;
  }
  return { sidebarColapsado, alternarSidebar };
});
