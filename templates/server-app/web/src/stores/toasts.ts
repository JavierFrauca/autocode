import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Notificaciones tipo "toast" (avisos breves no bloqueantes): éxito al guardar, error de red, etc.
 * Para confirmaciones/entradas usa diálogos (`lib/dialogs`). Uso en cualquier componente:
 *   const toast = useToastStore(); toast.ok("Guardado"); toast.error("No se pudo guardar");
 */
export type TipoToast = "ok" | "error" | "info" | "warn";
export interface Toast { id: number; tipo: TipoToast; mensaje: string }

export const useToastStore = defineStore("toasts", () => {
  const toasts = ref<Toast[]>([]);
  let seq = 0;

  function mostrar(mensaje: string, tipo: TipoToast = "info", ms = 4000): void {
    const id = ++seq;
    toasts.value.push({ id, tipo, mensaje });
    if (ms > 0) setTimeout(() => quitar(id), ms);
  }
  function quitar(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  const ok = (m: string) => mostrar(m, "ok");
  const error = (m: string) => mostrar(m, "error", 6000);
  const info = (m: string) => mostrar(m, "info");
  const warn = (m: string) => mostrar(m, "warn", 5000);

  return { toasts, mostrar, quitar, ok, error, info, warn };
});
